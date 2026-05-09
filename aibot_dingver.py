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

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from openai import OpenAI
import customtkinter as ctk
from tkinter import messagebox

from prompts import (
    DINGTALK_PROMPT,
    formal_instruction,
    CONTENT_MODERATION_PROMPT,
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


@fastapi_app.post("/api/transcribe")
def api_transcribe(body: TranscribeRequest):
    inst = _transcriber_instance
    b64_len = len(body.audioBase64) if body.audioBase64 else 0
    print(f"[API] POST /api/transcribe รับแล้ว (Base64 ~{b64_len // 1000}k ตัวอักษร)")
    if inst is None or not inst.is_ai_active:
        print("[API] ตอบกลับ: paused (แอปยังไม่พร้อม หรือปิด AI)")
        return {"status": "paused"}
    try:
        out = inst.run_transcribe_chain(body.audioBase64)
        print(
            f"[API] สำเร็จ — isSensitive={out.get('isSensitive')} "
            f"ความยาวข้อความ={len((out.get('text') or ''))}"
        )
        return out
    except ValueError as e:
        print(f"[API] ผิดพลาด 400: {e}")
        return JSONResponse(status_code=400, content={"status": "error", "message": str(e)})
    except Exception as e:
        print(f"[API] ผิดพลาด 500: {e}")
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
    "google/gemini-2.5-flash-lite",
    "google/gemini-2.5-flash",
    "openai/gpt-4o-mini",
]
DEFAULT_AUDIO_MODEL = "google/gemini-2.5-flash-lite"

OPENROUTER_TEXT_MODELS = [
    "google/gemini-3.1-flash-lite-preview",
    "google/gemini-2.5-flash-lite",
    "google/gemini-2.5-flash",
    "openai/gpt-4o-mini",
]
DEFAULT_FORMAL_MODEL = "google/gemini-2.5-flash-lite"

MODERATION_MODEL = "openai/gpt-4o-mini"

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


def collapse_overspaced_thai(text: str) -> str:
    if not text:
        return text
    thai = r"[\u0E00-\u0E7F]"
    out = re.sub(rf"(?<={thai})\s+(?={thai})", "", text)
    return re.sub(r" +", " ", out).strip()


def transcribe_audio_with_retry(
    oa_client: OpenAI,
    primary_audio_model: str,
    audio_b64: str,
    prompt: str,
) -> str:
    model_candidates: list[str] = []
    if primary_audio_model:
        model_candidates.append(primary_audio_model)
    for m in OPENROUTER_AUDIO_MODELS:
        if m not in model_candidates:
            model_candidates.append(m)

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


def parse_moderation_is_sensitive(content: str) -> bool:
    """True = sensitive (YES). Ambiguous → True (fail closed)."""
    t = (content or "").strip().upper()
    m = re.search(r"\b(YES|NO)\b", t)
    if m:
        return m.group(1) == "YES"
    return True


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

        self.load_config()
        if self.audio_model not in OPENROUTER_AUDIO_MODELS:
            self.audio_model = DEFAULT_AUDIO_MODEL
        if self.formal_model not in OPENROUTER_TEXT_MODELS:
            self.formal_model = DEFAULT_FORMAL_MODEL
        self.setup_window(resource_path)
        self.setup_ui()

        _transcriber_instance = self
        threading.Thread(target=self._run_uvicorn, daemon=True).start()
        print(f"🌐 Local API: http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/api/transcribe")
        print("🚀 ระบบพร้อมทำงานแล้ว!")

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
            am = saved.get("audio_model")
            if isinstance(am, str) and am.strip() and am.strip() in OPENROUTER_AUDIO_MODELS:
                self.audio_model = am.strip()
            fm = saved.get("formal_model")
            if isinstance(fm, str) and fm.strip() and fm.strip() in OPENROUTER_TEXT_MODELS:
                self.formal_model = fm.strip()
        except Exception as e:
            print(f"⚠️ เกิดปัญหาการโหลดการตั้งค่า: {e}")

    def save_config(self):
        try:
            data = {
                "audio_model": self.audio_model,
                "formal_model": self.formal_model,
            }
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"❌ ไม่สามารถบันทึกการตั้งค่าได้: {e}")

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

        b64_clean = base64.b64encode(raw_bytes).decode("ascii")

        prompt_rules = (
            DINGTALK_PROMPT
            + "\n- NO BRACKETS: ห้ามสร้างวงเล็บ () เด็ดขาด ลบวงเล็บทิ้งให้หมด"
        )
        raw_content = transcribe_audio_with_retry(
            client, audio_model, b64_clean, prompt_rules
        )
        result_text = " ".join((raw_content or "").strip().split())
        result_text = re.sub(r"[()]", "", result_text)
        result_text = collapse_overspaced_thai(result_text)

        if not result_text:
            return {"status": "success", "text": "", "isSensitive": False}

        max_out = min(8192, max(512, int(len(result_text) * 1.5) + 400))
        formal_resp = client.chat.completions.create(
            model=formal_model,
            messages=[
                {"role": "system", "content": formal_instruction},
                {"role": "user", "content": result_text},
            ],
            temperature=0.1,
            max_tokens=max_out,
            timeout=90,
        )
        formatted = (formal_resp.choices[0].message.content or "").strip().replace("-", " ")
        formatted = strip_special_chars(formatted)

        mod_resp = client.chat.completions.create(
            model=MODERATION_MODEL,
            messages=[
                {"role": "system", "content": CONTENT_MODERATION_PROMPT},
                {"role": "user", "content": formatted},
            ],
            temperature=0.0,
            max_tokens=16,
            timeout=30,
        )
        mod_raw = mod_resp.choices[0].message.content or ""
        is_sensitive = parse_moderation_is_sensitive(mod_raw)

        return {
            "status": "success",
            "text": formatted,
            "isSensitive": is_sensitive,
        }

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

    def _on_audio_model_change(self, value):
        if value in OPENROUTER_AUDIO_MODELS:
            with self._models_lock:
                self.audio_model = value
            self.save_config()
            print(f"🎯 เปลี่ยนโมเดลถอดเสียงเป็น: {value}")

    def _on_formal_model_change(self, value):
        if value in OPENROUTER_TEXT_MODELS:
            with self._models_lock:
                self.formal_model = value
            self.save_config()
            print(f"🎯 เปลี่ยนโมเดล Formal เป็น: {value}")

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
    app = AITranscriberApp()
    app.mainloop()
