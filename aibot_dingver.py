import os
import re
import sys
import json
import time
import base64
import random
import threading
import urllib.request
import urllib.error
import subprocess
from typing import Any
from dataclasses import dataclass, field
from hashlib import sha256

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from openai import OpenAI
import customtkinter as ctk
from tkinter import messagebox

# pyautogui ใช้สำหรับ "physical mouse click" จาก Python ไปที่หน้าจอจริง
# โหลดแบบ optional — ถ้าไม่มีลิบนี้ ระบบทำงานต่อได้ (แค่ /api/physical_click จะคืน 503)
try:
    import pyautogui

    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.0
    _PYAUTOGUI_AVAILABLE = True
except Exception as _pa_err:  # ImportError / DISPLAY missing / etc.
    pyautogui = None  # type: ignore
    _PYAUTOGUI_AVAILABLE = False
    print(f"⚠️ pyautogui ไม่พร้อมใช้งาน: {_pa_err} — /api/physical_click จะคืน 503")

# Windows: ทำให้ process รับรู้ DPI scaling จริง → พิกัด pyautogui ตรงกับสิ่งที่ผู้ใช้เห็น
if sys.platform.startswith("win"):
    try:
        import ctypes

        # 1 = PROCESS_SYSTEM_DPI_AWARE (รองรับตั้งแต่ Windows 8.1+)
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception as _dpi_err:
        try:
            ctypes.windll.user32.SetProcessDPIAware()  # type: ignore[name-defined]
        except Exception:
            print(f"⚠️ ตั้ง DPI awareness ไม่ได้ ({_dpi_err}) — physical click อาจคลาดเคลื่อนบนจอ scale > 100%")


def _get_virtual_screen_bounds():
    """คืน (left, top, right, bottom) ของ virtual desktop = ผลรวมทุกจอที่ต่ออยู่

    บน Windows ผ่าน GetSystemMetrics (รองรับ multi-monitor และจอที่อยู่ทางซ้าย/บนของจอหลัก)
    ค่า left/top อาจเป็นลบ (เช่น จอที่ 2 อยู่ทางซ้ายของจอหลัก)

    ถ้าไม่ใช่ Windows หรือดึงไม่สำเร็จ → fallback เป็นขนาดจอหลักจาก pyautogui
    """
    if sys.platform.startswith("win"):
        try:
            import ctypes

            user32 = ctypes.windll.user32
            # ค่าคงที่ SM_*VIRTUALSCREEN
            SM_XVIRTUALSCREEN = 76
            SM_YVIRTUALSCREEN = 77
            SM_CXVIRTUALSCREEN = 78
            SM_CYVIRTUALSCREEN = 79
            left = int(user32.GetSystemMetrics(SM_XVIRTUALSCREEN))
            top = int(user32.GetSystemMetrics(SM_YVIRTUALSCREEN))
            width = int(user32.GetSystemMetrics(SM_CXVIRTUALSCREEN))
            height = int(user32.GetSystemMetrics(SM_CYVIRTUALSCREEN))
            if width > 0 and height > 0:
                return (left, top, left + width, top + height)
        except Exception:
            pass
    if _PYAUTOGUI_AVAILABLE and pyautogui is not None:
        try:
            w, h = pyautogui.size()
            return (0, 0, int(w), int(h))
        except Exception:
            pass
    return (0, 0, 1920, 1080)


def _smooth_move_to_via_setcursor(x0, y0, x1, y1, duration_s, tween_fn=None, steps_per_sec=120):
    """เลื่อนเมาส์จาก (x0,y0) → (x1,y1) โดยใช้ Windows SetCursorPos ตรง ๆ

    ใช้แทน pyautogui.moveTo() ในเคส multi-monitor — เพราะ pyautogui บางครั้ง clamp พิกัด
    ระหว่างทางเข้าสู่จอหลัก ทำให้เมาส์ "วาบ" กลับจอหลักก่อนแล้วค่อยกระโดดไปจุดเป้า

    - duration_s: ระยะเวลาเลื่อน (วินาที) — 0 = ย้ายทันทีโดยไม่ animate
    - tween_fn: easing function (pytweening), default linear
    - steps_per_sec: จำนวนเฟรมต่อวินาที (default 120 — ดูลื่นพอสมควร)
    """
    import ctypes

    user32 = ctypes.windll.user32
    set_cursor_pos = user32.SetCursorPos

    if duration_s <= 0:
        set_cursor_pos(int(round(x1)), int(round(y1)))
        return

    total_steps = max(2, int(duration_s * steps_per_sec))
    start_t = time.perf_counter()
    end_t = start_t + duration_s
    for step in range(1, total_steps + 1):
        # ใช้ wall-clock progress แทน step ratio เพื่อให้แม่นยำกว่า
        now = time.perf_counter()
        if now >= end_t:
            t = 1.0
        else:
            t = (now - start_t) / duration_s
        try:
            eased = float(tween_fn(t)) if tween_fn is not None else t
        except Exception:
            eased = t
        eased = max(0.0, min(1.0, eased))
        cx = x0 + (x1 - x0) * eased
        cy = y0 + (y1 - y0) * eased
        set_cursor_pos(int(round(cx)), int(round(cy)))
        if t >= 1.0:
            break
        # หน่วงสั้น ๆ ให้ดูเป็นการเคลื่อนต่อเนื่อง
        time.sleep(max(0.0, (1.0 / steps_per_sec)))
    # ยืนยันตำแหน่งสุดท้ายอีกครั้ง (กันกรณี last step ไม่ตรงเป๊ะ)
    set_cursor_pos(int(round(x1)), int(round(y1)))

from prompts import (
    DINGTALK_PROMPT,
    formal_instruction,
    formal_spacing_fix_instruction,
    CONTENT_MODERATION_PROMPT,
    CONTENT_MODERATION_RECHECK_PROMPT,
    NON_TARGET_LANGUAGE_PROMPT,
)
from aibot_gui import AppUI

# ==========================================
# FastAPI app (routes use _transcriber_instance)
# ==========================================
_transcriber_instance: Any = None

fastapi_app = FastAPI(title="DingTag Local API")
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://scale\.dingtalk\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranscribeRequest(BaseModel):
    audioBase64: str = Field(..., description="WAV file bytes, standard Base64")
    asyncMode: bool = Field(False, description="If true, returns a jobId immediately")


class FormalizeRequest(BaseModel):
    text: str = Field(..., description="Plain transcript text")


class PhysicalClickRequest(BaseModel):
    """Browser ส่งพิกัดปุ่มมา (CSS viewport coord + window geometry) ให้ Python คลิกจริงๆ"""

    x: float = Field(..., description="ตำแหน่ง X กลางปุ่ม ใน viewport (CSS pixel)")
    y: float = Field(..., description="ตำแหน่ง Y กลางปุ่ม ใน viewport (CSS pixel)")
    screenX: float = Field(..., description="window.screenX")
    screenY: float = Field(..., description="window.screenY")
    outerWidth: float = Field(..., description="window.outerWidth")
    outerHeight: float = Field(..., description="window.outerHeight")
    innerWidth: float = Field(..., description="window.innerWidth")
    innerHeight: float = Field(..., description="window.innerHeight")
    devicePixelRatio: float = Field(1.0, description="window.devicePixelRatio")
    button: str = Field("left", description="left|right|middle")
    moveDurationMs: int = Field(120, description="ระยะเวลาเลื่อนเมาส์ก่อนคลิก (ms)")
    description: str = Field("", description="คำอธิบายสำหรับ log")
    restorePosition: bool = Field(True, description="คืนตำแหน่งเมาส์เดิมหลังคลิกเสร็จ")


@dataclass
class TranscribeJob:
    jobId: str
    status: str = "queued"  # queued|running|success|error|paused
    step: str = "queued"
    message: str = ""
    startedAt: float = 0.0
    finishedAt: float = 0.0
    audioBytes: int = 0
    audioSha256_12: str = ""
    isSensitive: bool | None = None
    textLen: int = 0
    result: dict | None = None
    error: str | None = None
    history: list[dict] = field(default_factory=list)


_jobs_lock = threading.Lock()
_jobs: dict[str, TranscribeJob] = {}

# Session task / time tracker (GUI + GET /api/stats)
_stats_lock = threading.Lock()
_session_started_at: float = 0.0
_stats_transcribe_ok: int = 0
_stats_formalize_ok: int = 0
_stats_processing_seconds: float = 0.0


def _session_stats_record_transcribe(duration_s: float) -> None:
    global _stats_transcribe_ok, _stats_processing_seconds
    with _stats_lock:
        _stats_transcribe_ok += 1
        _stats_processing_seconds += max(0.0, duration_s)


def _session_stats_record_formalize(duration_s: float) -> None:
    global _stats_formalize_ok, _stats_processing_seconds
    with _stats_lock:
        _stats_formalize_ok += 1
        _stats_processing_seconds += max(0.0, duration_s)


def get_session_stats() -> dict[str, Any]:
    """Snapshot for UI and GET /api/stats."""
    now = time.time()
    with _stats_lock:
        started = _session_started_at
        t_ok = _stats_transcribe_ok
        f_ok = _stats_formalize_ok
        proc = _stats_processing_seconds
    elapsed = max(0.0, now - started) if started > 0 else 0.0
    return {
        "sessionStartedAt": started,
        "sessionElapsedSeconds": elapsed,
        "transcribeCompleted": t_ok,
        "formalizeCompleted": f_ok,
        "processingSeconds": proc,
    }


def _new_job_id() -> str:
    # short id: epoch-ms + random
    return f"job_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"


def _job_snapshot(job: TranscribeJob) -> dict:
    return {
        "jobId": job.jobId,
        "status": job.status,
        "step": job.step,
        "message": job.message,
        "startedAt": job.startedAt,
        "finishedAt": job.finishedAt,
        "audioBytes": job.audioBytes,
        "audioSha256_12": job.audioSha256_12,
        "textLen": job.textLen,
        "isSensitive": job.isSensitive,
        "error": job.error,
        "history": job.history[-30:],
        "result": job.result if job.status == "success" else None,
    }


def _job_update(job_id: str, *, status: str | None = None, step: str | None = None, message: str | None = None, **extra):
    now = time.time()
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        if status is not None:
            job.status = status
        if step is not None:
            job.step = step
        if message is not None:
            job.message = message
        for k, v in extra.items():
            if hasattr(job, k):
                setattr(job, k, v)
        job.history.append(
            {
                "ts": now,
                "status": job.status,
                "step": job.step,
                "message": job.message,
            }
        )


@fastapi_app.get("/api/transcribe/jobs/{job_id}")
def api_transcribe_job_status(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse(status_code=404, content={"status": "error", "message": "job not found"})
        return _job_snapshot(job)


def _is_probably_wav(raw: bytes) -> bool:
    # Minimal RIFF/WAVE header check
    if len(raw) < 12:
        return False
    return raw[0:4] == b"RIFF" and raw[8:12] == b"WAVE"


@fastapi_app.post("/api/transcribe")
def api_transcribe(body: TranscribeRequest):
    inst = _transcriber_instance
    b64_len = len(body.audioBase64) if body.audioBase64 else 0
    print(f"[API] POST /api/transcribe รับแล้ว (Base64 ~{b64_len // 1000}k ตัวอักษร)")
    if inst is None or not inst.is_ai_active:
        print("[API] ตอบกลับ: paused (แอปยังไม่พร้อม หรือปิด AI)")
        return {"status": "paused"}

    try:
        if body.asyncMode:
            job_id = _new_job_id()
            job = TranscribeJob(jobId=job_id, status="queued", step="queued", startedAt=time.time())
            with _jobs_lock:
                _jobs[job_id] = job
            _job_update(job_id, status="running", step="received", message="รับคำขอแล้ว")
            threading.Thread(
                target=inst.run_transcribe_job,
                args=(job_id, body.audioBase64),
                daemon=True,
            ).start()
            return {"status": "accepted", "jobId": job_id}

        # Step 1 (for Extension): transcribe + basic clean + moderate only (no formalize yet)
        out = inst.run_transcribe_then_moderate(body.audioBase64)
        qc = out.get("qc") or {}
        print(
            f"[API] สำเร็จ — isSensitive={out.get('isSensitive')} "
            f"nonTarget={qc.get('isNonTarget')} englishRatio={qc.get('englishRatio')} "
            f"ความยาวข้อความ={len((out.get('text') or ''))}"
        )
        return out
    except ValueError as e:
        print(f"[API] ผิดพลาด 400: {e}")
        return JSONResponse(status_code=400, content={"status": "error", "message": str(e)})
    except Exception as e:
        print(f"[API] ผิดพลาด 500: {e}")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})


@fastapi_app.get("/api/stats")
def api_stats():
    """สถิติเซสชันปัจจุบัน: เวลาเปิดแอป, จำนวนไฟล์ถอดเสียงสำเร็จ, ครั้งที่ formalize สำเร็จ, เวลารวมในโมเดล."""
    return get_session_stats()


@fastapi_app.post("/api/formalize")
def api_formalize(body: FormalizeRequest):
    inst = _transcriber_instance
    if inst is None or not inst.is_ai_active:
        return {"status": "paused"}
    try:
        return inst.run_formalize_only(body.text)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"status": "error", "message": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})


@fastapi_app.post("/api/physical_click")
def api_physical_click(body: PhysicalClickRequest):
    """Physical mouse click ที่ระดับ OS — ใช้กับเคสที่ JS click ไม่ผ่าน (เช่น Label Studio Update button)

    คำนวณพิกัด:
      chrome_top  = outerHeight - innerHeight   (ความสูงรวมของ titlebar + toolbar)
      chrome_side = (outerWidth - innerWidth) / 2 (border ซ้าย)
      screen_x = screenX + chrome_side + body.x
      screen_y = screenY + chrome_top + body.y

    (process ถูก set เป็น DPI-aware ตอน import แล้ว → ใช้ logical pixel ตรงกับสิ่งที่ user เห็น)
    """
    if not _PYAUTOGUI_AVAILABLE or pyautogui is None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "message": "pyautogui ไม่พร้อมใช้งาน — pip install pyautogui",
            },
        )

    inst = _transcriber_instance
    if inst is None or not inst.is_ai_active:
        return {"status": "paused"}

    try:
        chrome_top = max(0.0, body.outerHeight - body.innerHeight)
        chrome_side = max(0.0, (body.outerWidth - body.innerWidth) / 2.0)
        sx = body.screenX + chrome_side + body.x
        sy = body.screenY + chrome_top + body.y
        x = int(round(sx))
        y = int(round(sy))

        # ใช้ "virtual desktop" (ผลรวมทุกจอ) แทนแค่จอหลัก เพื่อรองรับ multi-monitor
        # (ถ้า Chrome อยู่บนจอที่ 2 พิกัด screen_x อาจ >= 1920 หรืออาจเป็นลบ
        #  ถ้าจอที่ 2 อยู่ทางซ้าย — กรณีนี้ pyautogui.size() จะ false-reject)
        vs_left, vs_top, vs_right, vs_bottom = _get_virtual_screen_bounds()
        primary_w, primary_h = pyautogui.size()
        in_bounds = vs_left <= x < vs_right and vs_top <= y < vs_bottom
        if not in_bounds:
            msg = (
                f"พิกัดนอกจอ ({x},{y}) virtual=({vs_left},{vs_top})-({vs_right},{vs_bottom}) "
                f"primary=({primary_w}x{primary_h}) "
                f"viewport=({body.innerWidth}x{body.innerHeight}) "
                f"screenXY=({body.screenX},{body.screenY})"
            )
            print(f"❌ Physical click: {msg}")
            return JSONResponse(status_code=400, content={"status": "error", "message": msg})

        button = body.button if body.button in ("left", "right", "middle") else "left"
        desc = body.description or "physical click"
        prev_x, prev_y = pyautogui.position()
        duration_s = max(0.0, body.moveDurationMs / 1000.0)
        # ใช้ ease-in-out ให้รู้สึกเป็นธรรมชาติเหมือนคนขยับเมาส์จริง
        # (เริ่มช้า → เร่ง → ชะลอ ก่อนถึงเป้า)
        try:
            import pytweening as _pt

            tween_fn = getattr(_pt, "easeInOutQuad", None) or getattr(_pt, "linear", None)
        except Exception:
            tween_fn = None
        on_secondary = not (0 <= x < primary_w and 0 <= y < primary_h)
        print(
            f"🖱️ Physical click ({desc}) → ({x}, {y}) button={button} "
            f"prevPos=({prev_x},{prev_y}) move={duration_s:.2f}s "
            f"tween={'ease' if tween_fn else 'linear'} "
            f"{'[secondary monitor]' if on_secondary else '[primary]'}"
        )
        # หมายเหตุ multi-monitor:
        # บน Windows pyautogui ใช้ SetCursorPos → รองรับพิกัดข้ามจอได้ดี
        # แต่บางครั้ง moveTo() ที่มี duration > 0 จะถูก pyautogui "clamp" เข้าจอหลัก
        # ก่อนเลื่อน — แก้โดยเรียก moveTo(_pause=False) หรือใช้ ctypes SetCursorPos ตรง ๆ
        # หาก target อยู่นอกจอหลัก จะใช้ SetCursorPos แบบ step ๆ เองเพื่อให้ดูเป็น "ลาก mouse"
        if on_secondary and sys.platform.startswith("win"):
            try:
                _smooth_move_to_via_setcursor(prev_x, prev_y, x, y, duration_s, tween_fn)
            except Exception as _move_err:
                print(f"⚠️ smooth move (multi-monitor) ล้มเหลว → fallback pyautogui.moveTo: {_move_err}")
                if tween_fn is not None:
                    pyautogui.moveTo(x, y, duration=duration_s, tween=tween_fn)
                else:
                    pyautogui.moveTo(x, y, duration=duration_s)
        else:
            if tween_fn is not None:
                pyautogui.moveTo(x, y, duration=duration_s, tween=tween_fn)
            else:
                pyautogui.moveTo(x, y, duration=duration_s)
        pyautogui.click(x=x, y=y, button=button)

        if body.restorePosition:
            try:
                back_duration = max(0.2, duration_s * 0.6)
                back_on_secondary = not (
                    0 <= prev_x < primary_w and 0 <= prev_y < primary_h
                )
                if (on_secondary or back_on_secondary) and sys.platform.startswith("win"):
                    _smooth_move_to_via_setcursor(x, y, prev_x, prev_y, back_duration, tween_fn)
                elif tween_fn is not None:
                    pyautogui.moveTo(prev_x, prev_y, duration=back_duration, tween=tween_fn)
                else:
                    pyautogui.moveTo(prev_x, prev_y, duration=back_duration)
            except Exception:
                pass
        return {
            "status": "success",
            "clickedAt": [x, y],
            "virtualScreen": [vs_left, vs_top, vs_right, vs_bottom],
            "primaryScreen": [primary_w, primary_h],
            "onSecondaryMonitor": on_secondary,
        }
    except Exception as e:
        print(f"❌ Physical click ผิดพลาด: {e}")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})


# ==========================================
# Path helpers (.exe safe)
# ==========================================
def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


if getattr(sys, "frozen", False):
    application_path = os.path.dirname(sys.executable)
else:
    application_path = os.path.dirname(os.path.abspath(__file__))

CONFIG_FILE = os.path.join(application_path, "config.json")
GITHUB_REPO_OWNER = "Denbie"
GITHUB_REPO_NAME = "DingTag-C-Update"
GITHUB_API_BASE = f"https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}"
RAW_FILE_NAME = os.path.basename(__file__)
CURRENT_VERSION = "3.0A"
UPDATE_CHECK_TIMEOUT = 12

# ==========================================
# API / Model Config
# ==========================================
api_key = "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"
client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key.strip())

OPENROUTER_AUDIO_MODELS = [
    "google/gemini-3.1-flash-lite-preview",
]
DEFAULT_AUDIO_MODEL = "google/gemini-3.1-flash-lite-preview"

OPENROUTER_TEXT_MODELS = [
    "openai/gpt-4o-mini",
]
DEFAULT_FORMAL_MODEL = "openai/gpt-4o-mini"

MODERATION_MODEL = "openai/gpt-4o-mini"

# เมื่อผล formalize (เช่น gpt-4o-mini) เว้นวรรคถี่ผิดปกติทุกพยางค์ → ส่งให้ Gemini แก้ spacing
FORMAL_SPACING_FIX_MODEL = "google/gemini-2.5-flash-lite"

# Hallucination guard: เมื่อ primary model ถอดเสียงแล้วเจอ "คำซ้ำผิดธรรมชาติ" (AI หลอน เช่น
# "อืออืออือ..." วน 100+ รอบ, "เห้ยเห้ยเห้ย..." วน 30+ รอบ) → ลองใหม่กับ fallback model 1 ครั้ง
# ถ้ายังหลอนอีก → ใช้ผลลัพธ์ล่าสุดและทำขั้นตอนต่อไปตามปกติ
HALLUCINATION_FALLBACK_MODEL = "google/gemini-2.5-flash"
# Thresholds สำหรับ flag "หลอน": ขึ้นกับความยาวของ "หน่วยที่ซ้ำ" (unit)
# วลีไทยซ้ำ (เช่น "บ้านปูเป็นยังไง " ≈ 16 โค้ดพอยต์) ต้องให้ unit ยาวพอ — เดิม 15 ทำให้พลาดลูปยาว
HALLUCINATION_MAX_UNIT_LEN = 72      # unit ยาวเกินนี้ไม่ถือว่าเป็น repetition แล้ว
HALLUCINATION_TINY_UNIT_MAX = 2      # unit 1-2 ตัวอักษร
HALLUCINATION_TINY_REPS = 10         #   → flag เมื่อซ้ำ >= 10 รอบ
HALLUCINATION_SHORT_UNIT_MAX = 6     # unit 3-6 ตัวอักษร
HALLUCINATION_SHORT_REPS = 6         #   → flag เมื่อซ้ำ >= 6 รอบ
HALLUCINATION_LONG_REPS = 4          # unit 7+ ตัว → flag เมื่อซ้ำ >= 4 รอบ
HALLUCINATION_COVERAGE_RATIO = 0.25  # หรือช่วงซ้ำกินพื้นที่ >= 25% ของข้อความ
HALLUCINATION_COVERAGE_MIN_RUN = 30  #   (และยาว >= 30 ตัวอักษร, ซ้ำ >= 3 รอบ)

# Non-target QC: Latin letters vs Thai letters (rough "English share" of letters).
DEFAULT_NON_TARGET_ENGLISH_RATIO = 0.60
DEFAULT_NON_TARGET_GRAY_RATIO_LOW = 0.18

LOCAL_API_HOST = "127.0.0.1"
LOCAL_API_PORT = 54321


def is_transient_connection_error(e: Exception) -> bool:
    msg = str(e).lower()
    needles = [
        "connection error",
        "timed out",
        "timeout",
        "temporarily unavailable",
        "service unavailable",
        "bad gateway",
        "gateway timeout",
        "remote disconnected",
        "connection aborted",
        "connection reset",
        "ssl",
    ]
    return any(n in msg for n in needles)


def strip_special_chars(text: str) -> str:
    for ch in ['"', "'", ':', '：', '(', ')']:
        text = text.replace(ch, "")
    return text


def force_single_line(text: str) -> str:
    if text is None:
        return ""
    return " ".join(str(text).replace("\r", " ").replace("\n", " ").split()).strip()


def collapse_overspaced_thai(text: str) -> str:
    if not text:
        return text
    thai = r"[\u0E00-\u0E7F]"
    out = re.sub(rf"(?<={thai})\s+(?={thai})", "", text)
    return re.sub(r" +", " ", out).strip()


def count_thai_letters(text: str) -> int:
    return sum(1 for c in (text or "") if "\u0e00" <= c <= "\u0e7f")


def is_over_spaced_formal_thai(text: str) -> bool:
    """Heuristic: โมเดล formal (เช่น gpt-4o-mini) เว้นวรรคระหว่างพยางค์/ชิ้นเล็กถี่ผิดปกติ"""
    t = (text or "").strip()
    if len(t) < 50:
        return False
    thai_n = count_thai_letters(t)
    if thai_n < 28:
        return False
    sc = t.count(" ")
    if sc < 14:
        return False
    if sc / len(t) < 0.10:
        return False
    parts = t.split()
    if len(parts) < 14:
        return False
    avg = sum(len(p) for p in parts) / len(parts)
    if avg <= 3.4 and sc >= thai_n * 0.26:
        return True
    if avg <= 4.0 and sc / len(t) >= 0.14:
        return True
    # เคสปนคำยาว (เช่น ทราฟฟิก, สเตเดียม) ทำให้ avg สูง แต่ยัง "เว้นถี่" จริง — ดูสัดส่วนโทเคนสั้น + ความหนาแนนช่องว่าง
    short_n = sum(1 for p in parts if len(p) <= 4)
    short_share = short_n / len(parts)
    if (
        len(parts) >= 20
        and thai_n >= 40
        and sc / len(t) >= 0.14
        and short_share >= 0.52
    ):
        return True
    return False


def find_longest_repeated_run(
    text: str, max_unit_len: int = HALLUCINATION_MAX_UNIT_LEN
) -> tuple[str, int, int]:
    """หา 'หน่วยที่ซ้ำติดกัน' ซึ่งกินพื้นที่มากที่สุดในข้อความ

    คืน (unit, reps, run_chars) — สตริงของหน่วยซ้ำ, จำนวนรอบ, ความยาวรวม
    ตัวอย่าง:
      "อืออืออือ"  → ("อือ", 3, 9)
      "เห้ยเห้ย"   → ("เห้ย", 2, 8)
      "abcdef"     → ("", 0, 0)
    """
    if not text:
        return ("", 0, 0)
    n = len(text)
    best_unit = ""
    best_reps = 0
    best_run = 0
    max_u = min(max_unit_len, n // 2)
    for u in range(1, max_u + 1):
        i = 0
        while i + u <= n:
            unit = text[i:i + u]
            reps = 1
            j = i + u
            while j + u <= n and text[j:j + u] == unit:
                reps += 1
                j += u
            if reps >= 2:
                run = reps * u
                if run > best_run:
                    best_unit = unit
                    best_reps = reps
                    best_run = run
                i = j
            else:
                i += 1
    return (best_unit, best_reps, best_run)


def is_hallucinated_repetition(text: str) -> tuple[bool, dict]:
    """True ถ้าข้อความมีลักษณะ 'AI หลอน' = ซ้ำคำ/วลีเดิมยาวผิดธรรมชาติ

    เกณฑ์ (ปรับได้จากค่าคงที่ HALLUCINATION_*):
      - unit 1-2 ตัว: ซ้ำ >= HALLUCINATION_TINY_REPS (default 10)
      - unit 3-6 ตัว: ซ้ำ >= HALLUCINATION_SHORT_REPS (default 6)
      - unit 7+ ตัว: ซ้ำ >= HALLUCINATION_LONG_REPS (default 4)
      - หรือช่วงซ้ำกิน >= HALLUCINATION_COVERAGE_RATIO ของข้อความ
        + ยาว >= HALLUCINATION_COVERAGE_MIN_RUN ตัวอักษร + ซ้ำ >= 3 รอบ
    """
    info = {"unit": "", "reps": 0, "runChars": 0}
    if not text:
        return (False, info)
    unit, reps, run = find_longest_repeated_run(text)
    info = {"unit": unit, "reps": reps, "runChars": run}
    if not unit or reps < 2:
        return (False, info)
    ul = len(unit)
    if ul <= HALLUCINATION_TINY_UNIT_MAX and reps >= HALLUCINATION_TINY_REPS:
        return (True, info)
    if ul <= HALLUCINATION_SHORT_UNIT_MAX and reps >= HALLUCINATION_SHORT_REPS:
        return (True, info)
    if ul > HALLUCINATION_SHORT_UNIT_MAX and reps >= HALLUCINATION_LONG_REPS:
        return (True, info)
    if (
        run >= HALLUCINATION_COVERAGE_MIN_RUN
        and reps >= 3
        and (run / len(text)) >= HALLUCINATION_COVERAGE_RATIO
    ):
        return (True, info)
    return (False, info)


def stamp_final_hallucination_meta(meta: dict[str, Any], out_text: str) -> None:
    """ตั้ง stillHallucinated จากข้อความถอดเสียงสุดท้ายที่ส่งให้ client (ทุก path หลัง guard)"""
    bad, finfo = is_hallucinated_repetition(out_text or "")
    meta["stillHallucinated"] = bool(bad)
    if bad:
        meta["finalUnit"] = (finfo.get("unit") or "")[:30]
        meta["finalReps"] = int(finfo.get("reps", 0) or 0)
        meta["finalRunChars"] = int(finfo.get("runChars", 0) or 0)
    else:
        meta.pop("finalUnit", None)
        meta.pop("finalReps", None)
        meta.pop("finalRunChars", None)


def _clean_transcript_text(raw: str) -> str:
    """Pipeline ทำความสะอาดผลลัพธ์จาก ASR — ใช้ร่วมกันใน hallucination guard"""
    t = force_single_line(raw or "")
    t = re.sub(r"[()]", "", t)
    t = collapse_overspaced_thai(t)
    return force_single_line(t)


def transcribe_audio_with_retry(
    oa_client: OpenAI,
    primary_audio_model: str,
    audio_b64: str,
    prompt: str,
) -> str:
    model_candidates = [primary_audio_model or DEFAULT_AUDIO_MODEL]

    last_err: Exception | None = None
    for model_idx, model_name in enumerate(model_candidates[:3]):
        for attempt in range(1, 4):
            try:
                if attempt > 1:
                    print(f"[🔁] Retry {attempt}/3 (model: {model_name})...")
                return (
                    oa_client.chat.completions.create(
                        model=model_name,
                        max_tokens=500,
                        temperature=0.2,
                        timeout=30,
                        messages=[
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "input_audio",
                                        "input_audio": {"data": audio_b64, "format": "wav"},
                                    },
                                ],
                            }
                        ],
                    ).choices[0].message.content
                    or ""
                )
            except Exception as e:
                last_err = e
                if not is_transient_connection_error(e):
                    raise
                sleep_s = min(8.0, (2 ** (attempt - 1))) + random.random() * 0.4
                print(f"[⚠️] Connection error: {e} — รอ {sleep_s:.1f}s แล้วลองใหม่")
                time.sleep(sleep_s)
        if model_idx < 2:
            print(
                f"[🧩] เปลี่ยนโมเดลชั่วคราวเพื่อแก้ connection error: {model_name} -> {model_candidates[model_idx + 1]}"
            )

    raise last_err if last_err else RuntimeError("Unknown connection failure")


def chat_completion_with_retry(
    oa_client: OpenAI,
    model_candidates: list[str],
    messages: list[dict],
    *,
    temperature: float,
    max_tokens: int,
    timeout: int,
) -> str:
    last_err: Exception | None = None
    for model_idx, model_name in enumerate(model_candidates[:3]):
        for attempt in range(1, 4):
            try:
                if attempt > 1:
                    print(f"[🔁] Retry {attempt}/3 (model: {model_name})...")
                return (
                    oa_client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        timeout=timeout,
                    ).choices[0].message.content
                    or ""
                )
            except Exception as e:
                last_err = e
                if not is_transient_connection_error(e):
                    raise
                sleep_s = min(8.0, (2 ** (attempt - 1))) + random.random() * 0.4
                print(f"[⚠️] Connection error: {e} — รอ {sleep_s:.1f}s แล้วลองใหม่")
                time.sleep(sleep_s)
        if model_idx < 2:
            print(f"[🧩] เปลี่ยนโมเดลชั่วคราวเพื่อแก้ connection error: {model_name} -> {model_candidates[model_idx + 1]}")

    raise last_err if last_err else RuntimeError("Unknown connection failure")


_MODERATION_STRICT_USER_SUFFIX = "\n\nOutput only YES or NO."


def _parse_moderation_yes_no(content: str) -> bool | None:
    """True = YES, False = NO, None = no clear YES/NO token."""
    t = (content or "").strip().upper()
    m = re.search(r"\b(YES|NO)\b", t)
    if m:
        return m.group(1) == "YES"
    return None


def classify_content_sensitive_with_moderation(text: str) -> bool:
    """Primary moderation + optional recheck on YES; retry once if parse fails.

    Unparseable primary output after retry → not sensitive (avoid blocking on bad API output).
    Primary YES + recheck NO → not sensitive (sports/business false positive).
    Recheck unparseable after retry → not sensitive + log (same fail-open for format issues).
    """
    user = (text or "").strip()
    if not user:
        return False

    def _call(system: str, user_content: str) -> str:
        return chat_completion_with_retry(
            client,
            [MODERATION_MODEL],
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            temperature=0.0,
            max_tokens=16,
            timeout=30,
        )

    raw = _call(CONTENT_MODERATION_PROMPT, user)
    parsed = _parse_moderation_yes_no(raw)
    if parsed is None:
        raw = _call(CONTENT_MODERATION_PROMPT, user + _MODERATION_STRICT_USER_SUFFIX)
        parsed = _parse_moderation_yes_no(raw)
    if parsed is None:
        snippet = (raw or "").replace("\n", " ")[:120]
        print(f"[moderation] ไม่ parse ได้ YES/NO หลัง retry — ถือว่าไม่ sensitive | raw≈{snippet!r}")
        return False
    if not parsed:
        return False

    raw2 = _call(CONTENT_MODERATION_RECHECK_PROMPT, user)
    parsed2 = _parse_moderation_yes_no(raw2)
    if parsed2 is None:
        raw2 = _call(CONTENT_MODERATION_RECHECK_PROMPT, user + _MODERATION_STRICT_USER_SUFFIX)
        parsed2 = _parse_moderation_yes_no(raw2)
    if parsed2 is None:
        snippet = (raw2 or "").replace("\n", " ")[:120]
        print(f"[moderation] recheck ไม่ parse ได้ YES/NO หลัง retry — ถือว่าไม่ sensitive | raw≈{snippet!r}")
        return False
    return bool(parsed2)


def parse_non_target_is_yes(content: str) -> bool:
    """True = YES (non-target). Ambiguous → False (fail open; avoid false Invalid)."""
    t = (content or "").strip().upper()
    m = re.search(r"\b(YES|NO)\b", t)
    if m:
        return m.group(1) == "YES"
    return False


def latin_vs_thai_letter_ratio(text: str) -> float:
    """Share of Latin letters among (Latin + Thai) letters. 0.0 if no such letters."""
    if not text:
        return 0.0
    latin = thai = 0
    for ch in text:
        if "A" <= ch <= "Z" or "a" <= ch <= "z":
            latin += 1
        elif "\u0e00" <= ch <= "\u0e7f":
            thai += 1
    denom = latin + thai
    if denom <= 0:
        return 0.0
    return latin / denom


def has_thai_chars(text: str) -> bool:
    """True if at least one Thai script character (U+0E00..U+0E7F) is present."""
    if not text:
        return False
    for ch in text:
        if "\u0e00" <= ch <= "\u0e7f":
            return True
    return False


# Foreign script detection (everything that is NOT Thai/Latin script).
# Minimum absolute count + minimum share (relative to thai+latin+foreign letters)
# used to declare the transcript as Non-Target.
FOREIGN_SCRIPT_MIN_COUNT = 3
FOREIGN_SCRIPT_MIN_SHARE = 0.20

# Codepoint ranges for the foreign scripts we want to detect.
_FOREIGN_SCRIPT_RANGES: tuple[tuple[str, int, int], ...] = (
    # CJK Unified Ideographs + extensions + compatibility (Chinese / Han)
    ("chinese", 0x4E00, 0x9FFF),
    ("chinese", 0x3400, 0x4DBF),
    ("chinese", 0xF900, 0xFAFF),
    ("chinese", 0x20000, 0x2A6DF),
    # Japanese kana (Hiragana + Katakana + Katakana phonetic extensions)
    ("japanese", 0x3040, 0x309F),
    ("japanese", 0x30A0, 0x30FF),
    ("japanese", 0x31F0, 0x31FF),
    # Korean (Hangul syllables + Jamo + Compatibility Jamo)
    ("korean", 0xAC00, 0xD7AF),
    ("korean", 0x1100, 0x11FF),
    ("korean", 0x3130, 0x318F),
    # Cyrillic (Russian, Ukrainian, etc.)
    ("cyrillic", 0x0400, 0x04FF),
    ("cyrillic", 0x0500, 0x052F),
    # Arabic
    ("arabic", 0x0600, 0x06FF),
    ("arabic", 0x0750, 0x077F),
    # Hebrew
    ("hebrew", 0x0590, 0x05FF),
    # Devanagari (Hindi, Marathi, Sanskrit, etc.)
    ("devanagari", 0x0900, 0x097F),
    # Greek
    ("greek", 0x0370, 0x03FF),
)

FOREIGN_SCRIPT_LABELS: dict[str, str] = {
    "chinese": "จีน (CJK)",
    "japanese": "ญี่ปุ่น (ฮิรางานะ/คาตาคานะ)",
    "korean": "เกาหลี (ฮันกึล)",
    "cyrillic": "ซีริลลิก (รัสเซีย ฯลฯ)",
    "arabic": "อาหรับ",
    "hebrew": "ฮีบรู",
    "devanagari": "เทวนาครี (ฮินดี ฯลฯ)",
    "greek": "กรีก",
}


def count_script_chars(text: str) -> dict[str, int]:
    """Count characters by script class.

    Returns a dict with keys: thai, latin, chinese, japanese, korean,
    cyrillic, arabic, hebrew, devanagari, greek.
    Non-letter codepoints (digits, punctuation, whitespace) are ignored.
    """
    counts: dict[str, int] = {
        "thai": 0,
        "latin": 0,
        "chinese": 0,
        "japanese": 0,
        "korean": 0,
        "cyrillic": 0,
        "arabic": 0,
        "hebrew": 0,
        "devanagari": 0,
        "greek": 0,
    }
    if not text:
        return counts
    for ch in text:
        if "A" <= ch <= "Z" or "a" <= ch <= "z":
            counts["latin"] += 1
            continue
        cp = ord(ch)
        if 0x0E00 <= cp <= 0x0E7F:
            counts["thai"] += 1
            continue
        for label, start, end in _FOREIGN_SCRIPT_RANGES:
            if start <= cp <= end:
                counts[label] += 1
                break
    return counts


def detect_dominant_foreign_script(text: str) -> tuple[str | None, int, float]:
    """Detect the dominant foreign (non-Thai, non-Latin) script in `text`.

    Returns (label, count, share):
    - label: one of FOREIGN_SCRIPT_LABELS keys, or None if not significant.
    - count: absolute number of characters in that script.
    - share: count / (thai + latin + foreign_total). 0.0 if no letters.

    "Significant" means: count >= FOREIGN_SCRIPT_MIN_COUNT AND
    (no Thai at all, OR share >= FOREIGN_SCRIPT_MIN_SHARE).
    A few Japanese/Chinese characters inside an otherwise Thai sentence
    (e.g., brand names) will therefore NOT trigger Non-Target.
    """
    counts = count_script_chars(text)
    foreign_keys = ("chinese", "japanese", "korean", "cyrillic", "arabic", "hebrew", "devanagari", "greek")
    foreign_total = sum(counts[k] for k in foreign_keys)
    best_key = max(foreign_keys, key=lambda k: counts[k])
    best_count = counts[best_key]
    total_letters = counts["thai"] + counts["latin"] + foreign_total
    share = (best_count / total_letters) if total_letters > 0 else 0.0
    if best_count <= 0:
        return None, 0, 0.0
    significant = best_count >= FOREIGN_SCRIPT_MIN_COUNT and (
        counts["thai"] == 0 or share >= FOREIGN_SCRIPT_MIN_SHARE
    )
    if significant:
        return best_key, best_count, share
    return None, best_count, share


def _qc_defaults() -> dict[str, float]:
    return {
        "non_target_english_ratio": DEFAULT_NON_TARGET_ENGLISH_RATIO,
        "non_target_gray_low": DEFAULT_NON_TARGET_GRAY_RATIO_LOW,
    }


# ==========================================
# Main app
# ==========================================
class AITranscriberApp(AppUI, ctk.CTk):
    def __init__(self):
        global _transcriber_instance
        ctk.CTk.__init__(self)

        self.is_ai_active = True
        self.terminal_visible = True
        self.is_pinned = False
        self._models_lock = threading.Lock()
        self.audio_model = DEFAULT_AUDIO_MODEL
        self.formal_model = DEFAULT_FORMAL_MODEL
        self._uvicorn_server = None
        self.qc_config: dict[str, float] = _qc_defaults()

        self.load_config()
        self.audio_model = DEFAULT_AUDIO_MODEL
        self.formal_model = DEFAULT_FORMAL_MODEL
        self.setup_window(resource_path)
        self.setup_ui()

        global _session_started_at
        with _stats_lock:
            _session_started_at = time.time()

        _transcriber_instance = self
        threading.Thread(target=self._run_uvicorn, daemon=True).start()
        print(f"🌐 Local API: http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/api/transcribe")
        print("🚀 ระบบพร้อมทำงานแล้ว!")

        self.after(1000, self._tick_task_tracker)

        self._cleanup_old_exe()
        threading.Thread(target=self._startup_update_check, daemon=True).start()

    def _run_uvicorn(self):
        config = uvicorn.Config(
            fastapi_app,
            host=LOCAL_API_HOST,
            port=LOCAL_API_PORT,
            log_level="warning",
        )
        server = uvicorn.Server(config)
        self._uvicorn_server = server
        
        # ❌ ลบบรรทัดนี้ทิ้ง
        # server.serve() 
        
        # ✅ เพิ่ม 2 บรรทัดนี้เข้าไปแทนครับ
        import asyncio
        asyncio.run(server.serve())

    def load_config(self):
        if not os.path.exists(CONFIG_FILE):
            return
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            qc = saved.get("qc")
            if isinstance(qc, dict):
                base = _qc_defaults()
                for key in base:
                    v = qc.get(key)
                    if isinstance(v, (int, float)) and 0.0 <= float(v) <= 1.0:
                        base[key] = float(v)
                if base["non_target_gray_low"] >= base["non_target_english_ratio"]:
                    base["non_target_gray_low"] = DEFAULT_NON_TARGET_GRAY_RATIO_LOW
                self.qc_config = base
        except Exception as e:
            print(f"⚠️ เกิดปัญหาการโหลดการตั้งค่า: {e}")

    def save_config(self):
        try:
            data = {
                "qc": {k: float(self.qc_config.get(k, v)) for k, v in _qc_defaults().items()},
            }
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"❌ ไม่สามารถบันทึกการตั้งค่าได้: {e}")

    def _transcribe_with_hallucination_guard(
        self,
        primary_model: str,
        b64_clean: str,
        prompt_rules: str,
        *,
        job_id: str | None = None,
    ) -> tuple[str, dict]:
        """ถอดเสียง + ตรวจคำซ้ำผิดธรรมชาติ ("AI หลอน")

        Flow:
          1) ถอดด้วย primary_model
          2) ถ้าผลลัพธ์มีคำซ้ำเกินเกณฑ์ → ลองใหม่ด้วย HALLUCINATION_FALLBACK_MODEL
          3) ถ้ายังหลอน หรือ fallback ว่าง/พัง → คืนผลลัพธ์ของ primary (ทำขั้นตอนต่อไป)

        meta จะมี stillHallucinated จากข้อความที่คืนจริง — client ใช้ส่ง Invalid (Data Missing) หลังวางข้อความ

        คืน (cleaned_text, hallucination_meta)
        """
        raw_primary = transcribe_audio_with_retry(client, primary_model, b64_clean, prompt_rules)
        primary_text = _clean_transcript_text(raw_primary)
        primary_hallu, primary_info = is_hallucinated_repetition(primary_text)

        meta: dict[str, Any] = {
            "primaryModel": primary_model,
            "primaryHallucinated": bool(primary_hallu),
            "retried": False,
            "fallbackModel": "",
            "retriedHallucinated": False,
            "unit": (primary_info.get("unit") or "")[:30],
            "reps": int(primary_info.get("reps", 0) or 0),
            "runChars": int(primary_info.get("runChars", 0) or 0),
            "textLen": len(primary_text),
        }

        # No hallucination, or primary already IS the fallback → ใช้เลย
        if not primary_hallu or primary_model == HALLUCINATION_FALLBACK_MODEL:
            stamp_final_hallucination_meta(meta, primary_text)
            return (primary_text, meta)

        print(
            f"[🌀] Hallucination detected | model={primary_model} "
            f"unit='{meta['unit']}' reps={meta['reps']} run={meta['runChars']} "
            f"textLen={meta['textLen']} → retry with {HALLUCINATION_FALLBACK_MODEL}"
        )
        if job_id:
            _job_update(
                job_id,
                step="transcribe_retry",
                message=f"คำซ้ำผิดปกติ — ลองใหม่ด้วย {HALLUCINATION_FALLBACK_MODEL}",
            )

        try:
            raw_retry = transcribe_audio_with_retry(
                client, HALLUCINATION_FALLBACK_MODEL, b64_clean, prompt_rules
            )
        except Exception as e:
            print(f"[⚠️] Fallback model error: {e!r} — ใช้ผลลัพธ์ primary")
            stamp_final_hallucination_meta(meta, primary_text)
            return (primary_text, meta)

        retry_text = _clean_transcript_text(raw_retry)
        meta["retried"] = True
        meta["fallbackModel"] = HALLUCINATION_FALLBACK_MODEL

        if not retry_text:
            print("[⚠️] Fallback model คืนค่าว่าง — ใช้ผลลัพธ์ primary")
            stamp_final_hallucination_meta(meta, primary_text)
            return (primary_text, meta)

        retry_hallu, retry_info = is_hallucinated_repetition(retry_text)
        meta["retriedHallucinated"] = bool(retry_hallu)
        meta["retriedUnit"] = (retry_info.get("unit") or "")[:30]
        meta["retriedReps"] = int(retry_info.get("reps", 0) or 0)
        meta["retriedRunChars"] = int(retry_info.get("runChars", 0) or 0)
        meta["retriedTextLen"] = len(retry_text)

        if retry_hallu:
            print(
                f"[⚠️] Fallback ยังหลอนอีก | "
                f"unit='{meta['retriedUnit']}' reps={meta['retriedReps']} "
                f"run={meta['retriedRunChars']} — ใช้ผลลัพธ์ primary, ทำขั้นตอนต่อไป"
            )
            stamp_final_hallucination_meta(meta, primary_text)
            return (primary_text, meta)

        print(
            f"[✅] Fallback {HALLUCINATION_FALLBACK_MODEL} แก้ปัญหาคำซ้ำได้ "
            f"({meta['textLen']} → {meta['retriedTextLen']} chars)"
        )
        stamp_final_hallucination_meta(meta, retry_text)
        return (retry_text, meta)

    def _finalize_formatted_text(self, formatted: str) -> tuple[str, dict[str, Any]]:
        """หลัง formalize: ถ้าข้อความเว้นวรรคถี่แบบ GPT leak → ให้ Gemini Flash Lite จัด spacing ใหม่"""
        meta: dict[str, Any] = {
            "spacingRefined": False,
            "spacingModel": "",
            "reason": "",
        }
        if not formatted or not formatted.strip():
            return (formatted, meta)
        if not is_over_spaced_formal_thai(formatted):
            return (formatted, meta)

        meta["reason"] = "overspaced_thai_heuristic"
        sc = formatted.count(" ")
        print(
            f"[📐] Formal over-spacing detected (len={len(formatted)} spaces={sc}) "
            f"→ refine with {FORMAL_SPACING_FIX_MODEL}"
        )
        try:
            max_out = min(8192, max(512, int(len(formatted) * 1.2) + 200))
            refined_raw = chat_completion_with_retry(
                client,
                [FORMAL_SPACING_FIX_MODEL],
                messages=[
                    {"role": "system", "content": formal_spacing_fix_instruction},
                    {"role": "user", "content": formatted},
                ],
                temperature=0.0,
                max_tokens=max_out,
                timeout=90,
            )
            refined = force_single_line((refined_raw or "").strip().replace("-", " "))
            refined = strip_special_chars(refined)
            refined = force_single_line(refined)
            if refined and len(refined) >= max(20, int(len(formatted) * 0.45)):
                meta["spacingRefined"] = True
                meta["spacingModel"] = FORMAL_SPACING_FIX_MODEL
                print(
                    f"[✅] Spacing refine OK ({len(formatted)} → {len(refined)} chars, "
                    f"spaces {sc} → {refined.count(' ')})"
                )
                return (refined, meta)
            print("[⚠️] Spacing refine: ผลลัพธ์สั้นผิดปกติ — ใช้ข้อความ formal เดิม")
        except Exception as e:
            print(f"[⚠️] Spacing refine failed: {e!r} — ใช้ข้อความ formal เดิม")
        return (formatted, meta)

    def run_transcribe_chain(self, audio_b64: str) -> dict:
        with self._models_lock:
            audio_model = self.audio_model
            formal_model = self.formal_model

        try:
            raw_bytes = base64.b64decode(audio_b64, validate=False)
        except Exception as e:
            raise ValueError("Invalid Base64 audio") from e
        if not raw_bytes:
            raise ValueError("Empty audio payload")
        if not _is_probably_wav(raw_bytes):
            # Don't hard-fail (some callers might send non-standard headers), but flag it clearly.
            print("[API] ⚠️ ไฟล์เสียงอาจไม่ใช่ WAV (RIFF/WAVE header ไม่ตรง)")

        b64_clean = base64.b64encode(raw_bytes).decode("ascii")

        prompt_rules = (
            DINGTALK_PROMPT
            + "\n- NO BRACKETS: ห้ามสร้างวงเล็บ () เด็ดขาด ลบวงเล็บทิ้งให้หมด"
        )
        result_text, hallu_meta = self._transcribe_with_hallucination_guard(
            audio_model, b64_clean, prompt_rules
        )

        if not result_text:
            return {
                "status": "success",
                "text": "",
                "isSensitive": False,
                "qc": {
                    "isNonTarget": False,
                    "englishRatio": 0.0,
                    "nonTargetSource": "none",
                    "hallucination": hallu_meta,
                },
            }

        qc = self._classify_non_target_qc(result_text)
        qc["hallucination"] = hallu_meta

        max_out = min(8192, max(512, int(len(result_text) * 1.5) + 400))
        formatted_raw = chat_completion_with_retry(
            client,
            [formal_model],
            messages=[
                {"role": "system", "content": formal_instruction},
                {"role": "user", "content": result_text},
            ],
            temperature=0.1,
            max_tokens=max_out,
            timeout=90,
        )
        formatted = force_single_line((formatted_raw or "").strip().replace("-", " "))
        formatted = strip_special_chars(formatted)
        formatted = force_single_line(formatted)
        formatted, spacing_meta = self._finalize_formatted_text(formatted)
        if spacing_meta.get("spacingRefined"):
            qc["formalSpacing"] = spacing_meta

        is_sensitive = classify_content_sensitive_with_moderation(formatted)

        return {
            "status": "success",
            "text": formatted,
            "isSensitive": is_sensitive,
            "qc": qc,
        }

    def _moderate_text(self, text: str) -> bool:
        return classify_content_sensitive_with_moderation(text)

    def _classify_non_target_qc(self, result_text: str) -> dict[str, Any]:
        """Detect non-Central-Thai content (regional Thai dialects + foreign languages).

        Flow:
        0) เจออักษรต่างประเทศที่ไม่ใช่ไทย/ละติน (จีน/ญี่ปุ่น/เกาหลี/ซีริลลิก/อาหรับ/ฯลฯ)
           → non-target ทันที (ไม่ต้องเรียก LLM)
        1) ratio >= high      → non-target (English/foreign script dominant)
        2) มีอักษรไทย / ratio >= low → ส่งเข้า LLM (NON_TARGET_LANGUAGE_PROMPT)
           เพื่อจับภาษาถิ่น (เหนือ/อีสาน/ใต้) และภาษาต่างประเทศที่ปนภาษาไทยอยู่
        3) อื่นๆ → ไม่ใช่ non-target
        """
        cfg = getattr(self, "qc_config", None) or _qc_defaults()
        th = float(cfg.get("non_target_english_ratio", DEFAULT_NON_TARGET_ENGLISH_RATIO))
        low = float(cfg.get("non_target_gray_low", DEFAULT_NON_TARGET_GRAY_RATIO_LOW))
        ratio = latin_vs_thai_letter_ratio(result_text)
        has_thai = has_thai_chars(result_text)

        # (0) Fast path: clear non-Thai/non-Latin script (CJK, kana, Hangul, Cyrillic, ฯลฯ)
        foreign_label, foreign_count, foreign_share = detect_dominant_foreign_script(result_text)
        if foreign_label:
            return {
                "isNonTarget": True,
                "englishRatio": round(ratio, 4),
                "nonTargetSource": f"foreign_script_{foreign_label}",
                "foreignScript": foreign_label,
                "foreignScriptCount": foreign_count,
                "foreignScriptShare": round(foreign_share, 4),
            }

        is_non_target = False
        source: str = "none"
        if ratio >= th:
            is_non_target = True
            source = "english_ratio"
        elif has_thai or ratio >= low:
            raw = chat_completion_with_retry(
                client,
                [MODERATION_MODEL],
                messages=[
                    {"role": "system", "content": NON_TARGET_LANGUAGE_PROMPT},
                    {"role": "user", "content": (result_text or "")[:8000]},
                ],
                temperature=0.0,
                max_tokens=16,
                timeout=30,
            )
            is_non_target = parse_non_target_is_yes(raw)
            source = "llm_central_thai" if is_non_target else "none"
        return {
            "isNonTarget": is_non_target,
            "englishRatio": round(ratio, 4),
            "nonTargetSource": source,
        }

    def run_transcribe_then_moderate(self, audio_b64: str) -> dict:
        """Step 1: ASR + basic cleaning + moderation (NO formalize)."""
        t0 = time.time()
        with self._models_lock:
            audio_model = self.audio_model

        try:
            raw_bytes = base64.b64decode(audio_b64, validate=False)
        except Exception as e:
            raise ValueError("Invalid Base64 audio") from e
        if not raw_bytes:
            raise ValueError("Empty audio payload")
        if not _is_probably_wav(raw_bytes):
            print("[API] ⚠️ ไฟล์เสียงอาจไม่ใช่ WAV (RIFF/WAVE header ไม่ตรง)")

        b64_clean = base64.b64encode(raw_bytes).decode("ascii")
        prompt_rules = DINGTALK_PROMPT + "\n- NO BRACKETS: ห้ามสร้างวงเล็บ () เด็ดขาด ลบวงเล็บทิ้งให้หมด"
        result_text, hallu_meta = self._transcribe_with_hallucination_guard(
            audio_model, b64_clean, prompt_rules
        )

        if not result_text:
            _session_stats_record_transcribe(time.time() - t0)
            return {
                "status": "success",
                "text": "",
                "isSensitive": False,
                "qc": {
                    "isNonTarget": False,
                    "englishRatio": 0.0,
                    "nonTargetSource": "none",
                    "hallucination": hallu_meta,
                },
            }

        is_sensitive = self._moderate_text(result_text)
        qc = self._classify_non_target_qc(result_text)
        qc["hallucination"] = hallu_meta
        if hallu_meta.get("retried"):
            print(
                "[API] Hallucination guard | "
                f"primaryHallucinated={hallu_meta.get('primaryHallucinated')} "
                f"retriedHallucinated={hallu_meta.get('retriedHallucinated')} "
                f"fallback={hallu_meta.get('fallbackModel')}"
            )
        if qc.get("isNonTarget"):
            src = qc.get("nonTargetSource") or ""
            base_reasons = {
                "english_ratio": "อักษรอังกฤษ/อักษรไม่ใช่ไทยมีสัดส่วนสูง",
                "llm_central_thai": "ไม่ใช่ไทยกลาง (อาจเป็นภาษาถิ่น/ต่างประเทศ)",
            }
            if src.startswith("foreign_script_"):
                key = src[len("foreign_script_"):]
                label = FOREIGN_SCRIPT_LABELS.get(key, key)
                reason_th = f"พบอักษรภาษา{label}"
                print(
                    f"[API] QC Non-Target → {reason_th} | "
                    f"foreignScript={qc.get('foreignScript')} "
                    f"count={qc.get('foreignScriptCount')} "
                    f"share={qc.get('foreignScriptShare')} "
                    f"englishRatio={qc.get('englishRatio')} "
                    f"source={src}"
                )
            else:
                reason_th = base_reasons.get(src, src or "unknown")
                print(
                    f"[API] QC Non-Target → {reason_th} | englishRatio={qc.get('englishRatio')} "
                    f"source={src}"
                )
        _session_stats_record_transcribe(time.time() - t0)
        return {"status": "success", "text": result_text, "isSensitive": is_sensitive, "qc": qc}

    def run_formalize_only(self, text: str) -> dict:
        """Step 2: formalize only (expects raw already shown to user)."""
        t0 = time.time()
        with self._models_lock:
            formal_model = self.formal_model

        cleaned = force_single_line(text or "")
        cleaned = re.sub(r"[()]", "", cleaned)
        cleaned = collapse_overspaced_thai(cleaned)
        cleaned = force_single_line(cleaned)
        if not cleaned:
            _session_stats_record_formalize(time.time() - t0)
            return {"status": "success", "text": ""}

        max_out = min(8192, max(512, int(len(cleaned) * 1.5) + 400))
        formatted_raw = chat_completion_with_retry(
            client,
            [formal_model],
            messages=[
                {"role": "system", "content": formal_instruction},
                {"role": "user", "content": cleaned},
            ],
            temperature=0.1,
            max_tokens=max_out,
            timeout=90,
        )
        formatted = force_single_line((formatted_raw or "").strip().replace("-", " "))
        formatted = strip_special_chars(formatted)
        formatted = force_single_line(formatted)
        formatted, spacing_meta = self._finalize_formatted_text(formatted)
        _session_stats_record_formalize(time.time() - t0)
        out: dict[str, Any] = {"status": "success", "text": formatted}
        qc_out: dict[str, Any] = {}
        if spacing_meta.get("spacingRefined") or spacing_meta.get("reason"):
            qc_out["formalSpacing"] = spacing_meta
        hallu_formal: dict[str, Any] = {}
        stamp_final_hallucination_meta(hallu_formal, formatted)
        qc_out["hallucination"] = hallu_formal
        out["qc"] = qc_out
        return out

    def run_transcribe_job(self, job_id: str, audio_b64: str) -> None:
        # Step-by-step, with checkpoints written to the job store.
        t0 = time.time()
        try:
            _job_update(job_id, step="decode", message="กำลังถอด Base64 เป็นเสียง...")
            raw_bytes = base64.b64decode(audio_b64, validate=False)
            if not raw_bytes:
                raise ValueError("Empty audio payload")
            _job_update(
                job_id,
                audioBytes=len(raw_bytes),
                audioSha256_12=sha256(raw_bytes).hexdigest()[:12],
                step="validated",
                message="ตรวจสอบเสียงแล้ว (ได้ข้อมูลจริง)",
            )
            if not _is_probably_wav(raw_bytes):
                _job_update(job_id, step="validated", message="ตรวจสอบเสียงแล้ว (แต่ header WAV ไม่ตรง)")

            with self._models_lock:
                audio_model = self.audio_model
                formal_model = self.formal_model

            b64_clean = base64.b64encode(raw_bytes).decode("ascii")

            _job_update(job_id, step="transcribe", message="กำลังถอดเสียงเป็นข้อความ...")
            prompt_rules = DINGTALK_PROMPT + "\n- NO BRACKETS: ห้ามสร้างวงเล็บ () เด็ดขาด ลบวงเล็บทิ้งให้หมด"
            result_text, hallu_meta = self._transcribe_with_hallucination_guard(
                audio_model, b64_clean, prompt_rules, job_id=job_id
            )
            _job_update(
                job_id,
                step="transcribed",
                message="ถอดเสียงเสร็จแล้ว"
                + (" (retry with fallback model)" if hallu_meta.get("retried") else ""),
                textLen=len(result_text),
                hallucination=hallu_meta,
            )

            if not result_text:
                out = {
                    "status": "success",
                    "text": "",
                    "isSensitive": False,
                    "qc": {
                        "isNonTarget": False,
                        "englishRatio": 0.0,
                        "nonTargetSource": "none",
                        "hallucination": hallu_meta,
                    },
                }
                _job_update(job_id, status="success", step="done", message="เสร็จสิ้น (ไม่มีข้อความ)", finishedAt=time.time(), result=out, isSensitive=False)
                _session_stats_record_transcribe(time.time() - t0)
                return

            qc = self._classify_non_target_qc(result_text)
            qc["hallucination"] = hallu_meta

            _job_update(job_id, step="format", message="กำลังจัดข้อความให้เป็นทางการ...")
            max_out = min(8192, max(512, int(len(result_text) * 1.5) + 400))
            formatted_raw = chat_completion_with_retry(
                client,
                [formal_model],
                messages=[
                    {"role": "system", "content": formal_instruction},
                    {"role": "user", "content": result_text},
                ],
                temperature=0.1,
                max_tokens=max_out,
                timeout=90,
            )
            formatted = force_single_line((formatted_raw or "").strip().replace("-", " "))
            formatted = strip_special_chars(formatted)
            formatted = force_single_line(formatted)
            formatted, spacing_meta = self._finalize_formatted_text(formatted)
            msg = "จัดข้อความเสร็จแล้ว"
            if spacing_meta.get("spacingRefined"):
                msg += f" (แก้เว้นวรรคด้วย {spacing_meta.get('spacingModel', '')})"
            _job_update(job_id, step="formatted", message=msg, textLen=len(formatted))

            _job_update(job_id, step="moderate", message="กำลังตรวจสอบความอ่อนไหวของเนื้อหา...")
            is_sensitive = classify_content_sensitive_with_moderation(formatted)
            if spacing_meta.get("spacingRefined") or spacing_meta.get("reason"):
                qc["formalSpacing"] = spacing_meta
            out = {"status": "success", "text": formatted, "isSensitive": is_sensitive, "qc": qc}
            _job_update(
                job_id,
                status="success",
                step="done",
                message="เสร็จสิ้น",
                finishedAt=time.time(),
                result=out,
                isSensitive=is_sensitive,
                textLen=len(formatted),
            )
            _session_stats_record_transcribe(time.time() - t0)
        except Exception as e:
            _job_update(job_id, status="error", step="error", message="เกิดข้อผิดพลาด", finishedAt=time.time(), error=str(e))
            print(f"[API][JOB] job={job_id} error: {e}")

    def _format_duration_hms_thai(self, seconds: float) -> str:
        sec = max(0, int(seconds))
        h, rem = divmod(sec, 3600)
        m, s = divmod(rem, 60)
        if h > 0:
            return f"{h} ชม. {m} นาที"
        if m > 0:
            return f"{m} นาที {s} วินาที"
        return f"{s} วินาที"

    def _tick_task_tracker(self):
        try:
            st = get_session_stats()
            elapsed = float(st.get("sessionElapsedSeconds") or 0)
            proc = float(st.get("processingSeconds") or 0)
            n_files = int(st.get("transcribeCompleted") or 0)
            n_formal = int(st.get("formalizeCompleted") or 0)
            self.tracker_elapsed_label.configure(text=f"เซสชันนี้: {self._format_duration_hms_thai(elapsed)}")
            self.tracker_files_label.configure(text=f"ถอดเสียงสำเร็จ: {n_files} ไฟล์")
            self.tracker_formal_label.configure(text=f"Formalize สำเร็จ: {n_formal} ครั้ง")
            self.tracker_proc_label.configure(text=f"เวลาประมวลผล AI รวม: {self._format_duration_hms_thai(proc)}")
        except Exception:
            pass
        try:
            self.after(1000, self._tick_task_tracker)
        except Exception:
            pass

    # ==========================================
    # GitHub Updater
    # ==========================================
    def _get_github_headers(self):
        return {
            "User-Agent": "DingTag-CTeam-Updater",
            "Accept": "application/vnd.github.v3+json",
        }

    def _get_github_json(self, url):
        try:
            req = urllib.request.Request(url, headers=self._get_github_headers())
            with urllib.request.urlopen(req, timeout=UPDATE_CHECK_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise
        except Exception as e:
            print(f"⚠️ เกิดข้อผิดพลาดขณะเชื่อมต่อ GitHub: {e}")
            return None

    def _normalize_version(self, version: str):
        if not version:
            return []
        version = version.strip().lstrip("vV")
        parts = []
        for part in version.replace("-", ".").split("."):
            digits = "".join(ch for ch in part if ch.isdigit())
            parts.append(int(digits) if digits else 0)
        return parts

    def _is_version_newer(self, latest: str, current: str):
        return self._normalize_version(latest) > self._normalize_version(current)

    def _download_github_file(self, url, tag=None):
        req = urllib.request.Request(url, headers=self._get_github_headers())
        with urllib.request.urlopen(req, timeout=UPDATE_CHECK_TIMEOUT) as resp:
            return resp.read()

    def _build_update_candidates(self):
        candidates = []

        release_data = self._get_github_json(f"{GITHUB_API_BASE}/releases/latest")
        if isinstance(release_data, dict):
            tag_name = release_data.get("tag_name", "")
            asset_url = None
            for asset in release_data.get("assets") or []:
                name = asset.get("name", "").lower()
                url = asset.get("browser_download_url")
                if url and name.endswith((".exe", ".zip", ".py")):
                    asset_url = url
                    break
            candidates.append(
                {
                    "label": f"Release {tag_name}",
                    "version": tag_name,
                    "description": release_data.get("name", tag_name) or tag_name,
                    "asset_url": asset_url,
                    "type": "release",
                    "tag": tag_name,
                }
            )

        tags_data = self._get_github_json(f"{GITHUB_API_BASE}/tags") or []
        if isinstance(tags_data, list):
            for tag_item in tags_data[:5]:
                tag_name = tag_item.get("name")
                if tag_name and not any(c["version"] == tag_name for c in candidates):
                    raw_url = (
                        f"https://raw.githubusercontent.com/"
                        f"{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/{tag_name}/{RAW_FILE_NAME}"
                    )
                    candidates.append(
                        {
                            "label": f"Tag {tag_name}",
                            "version": tag_name,
                            "description": "Git tag version",
                            "asset_url": raw_url,
                            "type": "tag",
                            "tag": tag_name,
                        }
                    )
        return candidates

    def check_for_updates(self):
        self.update_btn.configure(state="disabled")
        self.update_status_label.configure(text="กำลังตรวจสอบอัปเดต...", text_color="#f1c40f")
        threading.Thread(target=self._check_for_updates_thread, daemon=True).start()

    def _check_for_updates_thread(self):
        try:
            candidates = self._build_update_candidates()
            self.after(0, self._show_update_options, candidates)
        except Exception as e:
            print(f"❌ ตรวจสอบอัปเดตล้มเหลว: {e}")
            self.after(0, self._update_button_reset)

    def _show_update_options(self, candidates):
        self._update_button_reset()
        if not candidates:
            self.update_status_label.configure(text="ไม่พบอัปเดตจาก GitHub", text_color="#e74c3c")
            print("🟡 ไม่พบ Release หรือ Tag บน GitHub")
            return

        latest = candidates[0]
        if not self._is_version_newer(latest["version"], CURRENT_VERSION):
            self.update_status_label.configure(
                text=f"✅ เวอร์ชันล่าสุดแล้ว ({CURRENT_VERSION})", text_color="#2ecc71"
            )
            print(f"✅ เวอร์ชันปัจจุบันเป็นเวอร์ชันล่าสุดแล้ว ({CURRENT_VERSION})")
            return

        answer = messagebox.askyesno(
            "พบอัปเดตใหม่",
            f"พบเวอร์ชันใหม่: {latest['version']}\n(ปัจจุบัน: {CURRENT_VERSION})\n\nต้องการอัปเดตตอนนี้เลยไหม?",
            parent=self,
        )
        if not answer:
            print("ℹ️ ยกเลิกการอัปเดตแล้ว")
            self.update_status_label.configure(
                text=f"เวอร์ชันปัจจุบัน: {CURRENT_VERSION}", text_color="#bdc3c7"
            )
            return

        self.update_status_label.configure(text=f"ดาวน์โหลด {latest['version']}...", text_color="#3498db")
        threading.Thread(target=self._download_and_apply_update, args=(latest,), daemon=True).start()

    def _download_and_apply_update(self, candidate):
        url = candidate.get("asset_url") or (
            f"https://raw.githubusercontent.com/"
            f"{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/{candidate['tag']}/{RAW_FILE_NAME}"
        )
        try:
            print(f"⏳ กำลังดาวน์โหลด {candidate['label']} จาก GitHub...")
            data = self._download_github_file(url, tag=candidate.get("tag"))

            if getattr(sys, "frozen", False):
                current_exe = sys.executable
                old_exe = current_exe + f".{int(time.time())}.old"
                os.rename(current_exe, old_exe)
                with open(current_exe, "wb") as f:
                    f.write(data)

                self.after(
                    0,
                    lambda: messagebox.showinfo(
                        "ดาวน์โหลดเสร็จสิ้น",
                        "อัปเดตสำเร็จ! โปรแกรมกำลังจะรีสตาร์ท...",
                        parent=self,
                    ),
                )
                print("✅ ติดตั้งอัปเดตไฟล์สำเร็จ กำลังรีสตาร์ท...")

                minimal_env = {
                    k: os.environ[k]
                    for k in [
                        "PATH",
                        "SystemRoot",
                        "WINDIR",
                        "COMSPEC",
                        "TEMP",
                        "TMP",
                        "USERPROFILE",
                        "APPDATA",
                        "LOCALAPPDATA",
                    ]
                    if k in os.environ
                }
                CREATE_NEW_PROCESS_GROUP = 0x00000200
                DETACHED_PROCESS = 0x00000008
                subprocess.Popen(
                    [current_exe],
                    env=minimal_env,
                    creationflags=CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS,
                    close_fds=True,
                )
                self.after(500, self.quit_app)

            else:
                target_path = os.path.join(application_path, RAW_FILE_NAME + ".new")
                with open(target_path, "wb") as f:
                    f.write(data)
                os.replace(target_path, os.path.join(application_path, RAW_FILE_NAME))
                self.after(
                    0,
                    lambda: messagebox.showinfo(
                        "อัปเดตสำเร็จ",
                        f"อัปเดตเวอร์ชันใหม่เรียบร้อยแล้ว\nไฟล์ถูกเขียนทับ {RAW_FILE_NAME}",
                        parent=self,
                    ),
                )
                print(f"✅ อัปเดตไฟล์เรียบร้อย: {RAW_FILE_NAME}")
                self.after(
                    0,
                    lambda: self.update_status_label.configure(
                        text=f"อัปเดตเป็น {candidate['version']} แล้ว", text_color="#2ecc71"
                    ),
                )

        except Exception as e:
            print(f"❌ อัปเดตล้มเหลว: {e}")
            self.after(
                0,
                lambda: self.update_status_label.configure(
                    text="อัปเดตไม่สำเร็จ", text_color="#e74c3c"
                ),
            )
            try:
                if getattr(sys, "frozen", False) and not os.path.exists(sys.executable):
                    old_files = [f for f in os.listdir(application_path) if f.endswith(".old")]
                    if old_files:
                        os.rename(os.path.join(application_path, old_files[-1]), sys.executable)
            except Exception:
                pass
        finally:
            self.after(0, self._update_button_reset)

    def _startup_update_check(self):
        try:
            candidates = self._build_update_candidates()
            if candidates and self._is_version_newer(candidates[0]["version"], CURRENT_VERSION):
                self.after(0, self._show_update_options, candidates)
        except Exception:
            pass

    def _cleanup_old_exe(self):
        if not getattr(sys, "frozen", False):
            return

        def delete_loop():
            time.sleep(3)
            for _ in range(15):
                old_files_exist = False
                for file_name in os.listdir(application_path):
                    if file_name.endswith(".old"):
                        old_files_exist = True
                        file_path = os.path.join(application_path, file_name)
                        try:
                            os.chmod(file_path, 0o777)
                            os.remove(file_path)
                            print(f"🧹 ลบไฟล์เวอร์ชันเก่าทิ้งสำเร็จ: {file_name}")
                        except Exception:
                            pass
                if not old_files_exist:
                    break
                time.sleep(2)

        threading.Thread(target=delete_loop, daemon=True).start()

    def quit_app(self):
        print("🔴 กำลังปิดโปรแกรม...")
        self.save_config()
        srv = getattr(self, "_uvicorn_server", None)
        if srv is not None:
            srv.should_exit = True
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
        self.destroy()
        os._exit(0)

    def on_window_close(self):
        self.quit_app()


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    app = AITranscriberApp()
    app.mainloop()
