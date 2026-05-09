import os
import re
import sys
import json
import time
import base64
import urllib.request
import urllib.error
import keyboard
import pyperclip
import threading
import ctypes
import tkinter as tk
from tkinter import messagebox, simpledialog
import customtkinter as ctk
from openai import OpenAI
import subprocess
import random

# ==========================================
# Import Prompts และ UI จากไฟล์แยก
# ==========================================
from prompts import DINGTALK_PROMPT, transcript_instruction, formal_instruction
from aibot_gui import AppUI

# ==========================================
# ฟังก์ชันจัดการ Path (ปลอดภัยสำหรับ .exe)
# ==========================================
def resource_path(relative_path):
    """หาตำแหน่งไฟล์เมื่อรันเป็น .exe"""
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


if getattr(sys, 'frozen', False):
    application_path = os.path.dirname(sys.executable)
else:
    application_path = os.path.dirname(os.path.abspath(__file__))

CONFIG_FILE          = os.path.join(application_path, "config.json")
GITHUB_REPO_OWNER    = "Denbie"
GITHUB_REPO_NAME     = "DingTag-C-Update"
GITHUB_API_BASE      = f"https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}"
RAW_FILE_NAME        = os.path.basename(__file__)
CURRENT_VERSION      = "3.0A"
UPDATE_CHECK_TIMEOUT = 12

# ==========================================
# API / Model Config
# ==========================================
api_key = "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"
client  = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key.strip())
MODEL   = "google/gemini-2.5-flash-lite"

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
DEFAULT_RAW_MODEL = "google/gemini-2.5-flash-lite"

DINGTALK_WAV = os.path.join(os.path.expanduser('~'), 'Downloads', 'dingtalk_temp.wav')


# ==========================================
# คลาสหลัก: Logic + UI (ผ่าน AppUI Mixin)
# ==========================================
class AITranscriberApp(AppUI, ctk.CTk):
    def __init__(self):
        ctk.CTk.__init__(self)

        # --- State เริ่มต้น ---
        self.is_ai_active         = True
        self.terminal_visible     = True
        self.is_pinned            = False
        self._processing_lock     = threading.Lock()
        self.hotkeys              = {"raw": "f8", "formal": "f9", "voice_typing": "f10", "dingtalk_voice": "f11"}
        self.listening_for        = None
        self._keyboard_listen_active = False
        self.voice_suppress       = True
        self.dingtalk_is_processing  = False
        self.audio_model          = DEFAULT_AUDIO_MODEL
        self.raw_model            = DEFAULT_RAW_MODEL
        self.formal_model         = DEFAULT_RAW_MODEL
        # หลังวางข้อความถอดเสียง DingTalk รอกี่วินาทีก่อนรัน Formal (ให้ textarea นิ่ง / โฟกัสพร้อม)
        self.dingtalk_formal_settle_delay = 1.0

        self.load_config()
        self.setup_window(resource_path)   # จาก AppUI
        self.setup_ui()                    # จาก AppUI

        self.register_all_hotkeys()
        threading.Thread(target=self._mouse_polling_daemon, daemon=True).start()

        print("🚀 ระบบพร้อมทำงานแล้ว!")

        self._cleanup_old_exe()
        threading.Thread(target=self._startup_update_check, daemon=True).start()

    # ==========================================
    # 1. Config — โหลด / บันทึก
    # ==========================================
    def load_config(self):
        if not os.path.exists(CONFIG_FILE):
            return
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            for k in self.hotkeys:
                if k in saved:
                    self.hotkeys[k] = saved[k]
            if "voice_suppress" in saved:
                self.voice_suppress = bool(saved["voice_suppress"])
            if "audio_model"  in saved: self.audio_model  = saved["audio_model"]
            if "raw_model"    in saved: self.raw_model    = saved["raw_model"]
            if "formal_model" in saved: self.formal_model = saved["formal_model"]
            if "dingtalk_formal_settle_delay" in saved:
                try:
                    self.dingtalk_formal_settle_delay = max(0.2, min(10.0, float(saved["dingtalk_formal_settle_delay"])))
                except (TypeError, ValueError):
                    pass
        except Exception as e:
            print(f"⚠️ เกิดปัญหาการโหลดการตั้งค่า: {e}")

    def save_config(self):
        try:
            data = dict(self.hotkeys)
            data["voice_suppress"] = self.voice_suppress
            data["audio_model"]    = self.audio_model
            data["raw_model"]      = self.raw_model
            data["formal_model"]   = self.formal_model
            data["dingtalk_formal_settle_delay"] = float(self.dingtalk_formal_settle_delay)
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"❌ ไม่สามารถบันทึกการตั้งค่าได้: {e}")

    # ==========================================
    # 2. GitHub Updater
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
            tag_name  = release_data.get("tag_name", "")
            asset_url = None
            for asset in (release_data.get("assets") or []):
                name = asset.get("name", "").lower()
                url  = asset.get("browser_download_url")
                if url and name.endswith((".exe", ".zip", ".py")):
                    asset_url = url
                    break
            candidates.append({
                "label":       f"Release {tag_name}",
                "version":     tag_name,
                "description": release_data.get("name", tag_name) or tag_name,
                "asset_url":   asset_url,
                "type":        "release",
                "tag":         tag_name,
            })

        tags_data = self._get_github_json(f"{GITHUB_API_BASE}/tags") or []
        if isinstance(tags_data, list):
            for tag_item in tags_data[:5]:
                tag_name = tag_item.get("name")
                if tag_name and not any(c["version"] == tag_name for c in candidates):
                    raw_url = (
                        f"https://raw.githubusercontent.com/"
                        f"{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/{tag_name}/{RAW_FILE_NAME}"
                    )
                    candidates.append({
                        "label":       f"Tag {tag_name}",
                        "version":     tag_name,
                        "description": "Git tag version",
                        "asset_url":   raw_url,
                        "type":        "tag",
                        "tag":         tag_name,
                    })
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
            parent=self
        )
        if not answer:
            print("ℹ️ ยกเลิกการอัปเดตแล้ว")
            self.update_status_label.configure(text=f"เวอร์ชันปัจจุบัน: {CURRENT_VERSION}", text_color="#bdc3c7")
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

            if getattr(sys, 'frozen', False):
                # โหมด EXE: Seamless Update
                current_exe = sys.executable
                old_exe     = current_exe + f".{int(time.time())}.old"
                os.rename(current_exe, old_exe)
                with open(current_exe, "wb") as f:
                    f.write(data)

                self.after(0, lambda: messagebox.showinfo(
                    "ดาวน์โหลดเสร็จสิ้น",
                    "อัปเดตสำเร็จ! โปรแกรมกำลังจะรีสตาร์ท...",
                    parent=self
                ))
                print("✅ ติดตั้งอัปเดตไฟล์สำเร็จ กำลังรีสตาร์ท...")

                minimal_env = {
                    k: os.environ[k]
                    for k in ["PATH", "SystemRoot", "WINDIR", "COMSPEC",
                              "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
                    if k in os.environ
                }
                CREATE_NEW_PROCESS_GROUP = 0x00000200
                DETACHED_PROCESS         = 0x00000008
                subprocess.Popen(
                    [current_exe], env=minimal_env,
                    creationflags=CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS,
                    close_fds=True
                )
                self.after(500, self.quit_app)

            else:
                # โหมด Python Script
                target_path = os.path.join(application_path, RAW_FILE_NAME + ".new")
                with open(target_path, "wb") as f:
                    f.write(data)
                os.replace(target_path, os.path.join(application_path, RAW_FILE_NAME))
                self.after(0, lambda: messagebox.showinfo(
                    "อัปเดตสำเร็จ",
                    f"อัปเดตเวอร์ชันใหม่เรียบร้อยแล้ว\nไฟล์ถูกเขียนทับ {RAW_FILE_NAME}",
                    parent=self
                ))
                print(f"✅ อัปเดตไฟล์เรียบร้อย: {RAW_FILE_NAME}")
                self.after(0, lambda: self.update_status_label.configure(
                    text=f"อัปเดตเป็น {candidate['version']} แล้ว", text_color="#2ecc71"
                ))

        except Exception as e:
            print(f"❌ อัปเดตล้มเหลว: {e}")
            self.after(0, lambda: self.update_status_label.configure(
                text="อัปเดตไม่สำเร็จ", text_color="#e74c3c"
            ))
            try:
                if getattr(sys, 'frozen', False) and not os.path.exists(sys.executable):
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

    # ==========================================
    # 3. ระบบทำความสะอาด .exe ตัวเก่า
    # ==========================================
    def _cleanup_old_exe(self):
        if not getattr(sys, 'frozen', False):
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

    # ==========================================
    # 4. Model Selector Callbacks
    # ==========================================
    def _on_audio_model_change(self, value):
        if value in OPENROUTER_AUDIO_MODELS:
            self.audio_model = value
            self.save_config()
            print(f"🎯 เปลี่ยนโมเดล ดูดเสียงและวางข้อความ เป็น: {value}")

    def _on_raw_model_change(self, value):
        if value in OPENROUTER_TEXT_MODELS:
            self.raw_model = value
            self.save_config()
            print(f"🎯 เปลี่ยนโมเดล จัด Format ข้อความ เป็น: {value}")

    def _on_formal_model_change(self, value):
        if value in OPENROUTER_TEXT_MODELS:
            self.formal_model = value
            self.save_config()
            print(f"🎯 เปลี่ยนโมเดล Formal (จัดการช่องว่าง) เป็น: {value}")

    # ==========================================
    # 5. Hotkey Registration (Mouse & Keyboard)
    # ==========================================
    def register_all_hotkeys(self):
        keyboard.unhook_all()
        for action, key in self.hotkeys.items():
            if not key or not str(key).strip():
                continue

            if "mouse" not in str(key).lower():
                try:
                    key_parts = str(key).lower().split('+')
                    if len(key_parts) > 1:
                        # Combo key (เช่น ctrl+d)
                        if action == "raw":
                            keyboard.add_hotkey(key, lambda: self.trigger_process("raw"),        suppress=self.is_ai_active)
                        elif action == "formal":
                            keyboard.add_hotkey(key, lambda: self.trigger_process("formal"),     suppress=self.is_ai_active)
                        elif action == "dingtalk_voice":
                            keyboard.add_hotkey(key, lambda: threading.Thread(target=self.dingtalk_transcribe_and_paste, daemon=True).start(), suppress=self.is_ai_active)
                        elif action == "voice_typing":
                            keyboard.add_hotkey(key, lambda: self.trigger_voice_typing(),        suppress=self.voice_suppress if self.is_ai_active else False)
                    else:
                        # Single key
                        if action == "raw":
                            keyboard.hook_key(key, lambda e: self.trigger_process("raw")        if e.event_type == keyboard.KEY_DOWN else None, suppress=self.is_ai_active)
                        elif action == "formal":
                            keyboard.hook_key(key, lambda e: self.trigger_process("formal")     if e.event_type == keyboard.KEY_DOWN else None, suppress=self.is_ai_active)
                        elif action == "dingtalk_voice":
                            keyboard.hook_key(key, lambda e: threading.Thread(target=self.dingtalk_transcribe_and_paste, daemon=True).start() if e.event_type == keyboard.KEY_DOWN else None, suppress=self.is_ai_active)
                        elif action == "voice_typing":
                            keyboard.hook_key(key, lambda e, k=key: self._voice_typing_hook(e, k), suppress=self.voice_suppress if self.is_ai_active else False)
                except ValueError:
                    print(f"⚠️ ไม่สามารถลงทะเบียนคีย์ '{key}' ได้ กรุณาเปลี่ยนปุ่มใหม่")

    def _mouse_polling_daemon(self):
        last_m4 = last_m5 = False
        while True:
            m4 = ctypes.windll.user32.GetAsyncKeyState(0x05) & 0x8000
            m5 = ctypes.windll.user32.GetAsyncKeyState(0x06) & 0x8000
            if m4 and not last_m4: self.after(0, self._handle_mouse_input, "mouse4")
            if m5 and not last_m5: self.after(0, self._handle_mouse_input, "mouse5")
            last_m4, last_m5 = m4, m5
            time.sleep(0.015)

    def _handle_mouse_input(self, btn_name):
        if self.listening_for:
            action = self.listening_for
            self.listening_for = None
            self._keyboard_listen_active = False
            self._apply_new_hotkey(action, btn_name)
        else:
            for act, key in self.hotkeys.items():
                if key.lower() == btn_name:
                    if act == "voice_typing":
                        self.trigger_voice_typing()
                    elif act == "dingtalk_voice":
                        threading.Thread(target=self.dingtalk_transcribe_and_paste, daemon=True).start()
                    else:
                        self.trigger_process(act)

    def _voice_typing_hook(self, event, key):
        if event.event_type == keyboard.KEY_DOWN:
            self.after(0, self.trigger_voice_typing)

    def trigger_voice_typing(self):
        if not self.is_ai_active:
            print("⚠️ โปรดเปิดใช้งานระบบ AI ก่อน!")
            return
        print("🎤 เปิด Voice Typing (Win+H)...")
        ctypes.windll.user32.keybd_event(0x5B, 0, 0, 0)
        ctypes.windll.user32.keybd_event(0x48, 0, 0, 0)
        ctypes.windll.user32.keybd_event(0x48, 0, 2, 0)
        ctypes.windll.user32.keybd_event(0x5B, 0, 2, 0)

    # ==========================================
    # 6. Hotkey Remapping
    # ==========================================
    def start_listening(self, action_key):
        self._keyboard_listen_active = False
        keyboard.unhook_all()
        for btn in self.hotkey_buttons.values():
            btn.configure(state="disabled")
        self.hotkey_buttons[action_key].configure(text="...")
        self.listening_for = action_key
        self._keyboard_listen_active = True
        print("⏳ รอรับคีย์ลัดใหม่... (กดคีย์บอร์ด หรือ Mouse 4/5 ได้เลย)")
        threading.Thread(target=self._record_keyboard_hotkey, args=(action_key,), daemon=True).start()

    def _record_keyboard_hotkey(self, action_key):
        time.sleep(0.2)
        result       = []
        hook_ref     = [None]
        pressed_keys = set()

        def on_key_event(event):
            if not result:
                if event.event_type == keyboard.KEY_DOWN:
                    pressed_keys.add(event.name.lower())
                    modifiers = [k for k in pressed_keys if k in {
                        'ctrl', 'alt', 'shift',
                        'left ctrl', 'right ctrl', 'left alt', 'right alt', 'left shift', 'right shift'
                    }]
                    main_keys = [k for k in pressed_keys if k not in {
                        'ctrl', 'alt', 'shift',
                        'left ctrl', 'right ctrl', 'left alt', 'right alt', 'left shift', 'right shift'
                    }]
                    if main_keys:
                        normalized_mods = []
                        if any(m.startswith('ctrl')  for m in modifiers): normalized_mods.append('ctrl')
                        if any(m.startswith('alt')   for m in modifiers): normalized_mods.append('alt')
                        if any(m.startswith('shift') for m in modifiers): normalized_mods.append('shift')
                        combo = '+'.join(normalized_mods + main_keys) if normalized_mods else main_keys[0]
                        result.append(combo)
                        if hook_ref[0]:
                            keyboard.unhook(hook_ref[0])
                elif event.event_type == keyboard.KEY_UP:
                    pressed_keys.discard(event.name.lower())

        hook_ref[0] = keyboard.hook(on_key_event, suppress=True)

        elapsed = 0
        while not result and elapsed < 30:
            time.sleep(0.05)
            elapsed += 0.05

        if hook_ref[0]:
            try: keyboard.unhook(hook_ref[0])
            except Exception: pass

        if not result:
            self._keyboard_listen_active = False
            self.listening_for = None
            self.after(0, lambda: [btn.configure(state="normal", text="เปลี่ยน") for btn in self.hotkey_buttons.values()])
            self.after(0, self.register_all_hotkeys)
            return

        new_key = result[0]
        if self._keyboard_listen_active and self.listening_for == action_key:
            self._keyboard_listen_active = False
            self.listening_for = None
            self.after(0, self._apply_new_hotkey, action_key, new_key)

    def _apply_new_hotkey(self, action_key, new_key):
        self.hotkeys[action_key] = new_key.lower()
        self.save_config()
        self.hotkey_labels[action_key].configure(text=new_key.upper())
        for btn in self.hotkey_buttons.values():
            btn.configure(state="normal", text="เปลี่ยน")
        self.register_all_hotkeys()
        print(f"✅ บันทึกคีย์ลัดใหม่สำเร็จ: {new_key.upper()}")

    # ==========================================
    # 7. Text Processing (Raw / Formal)
    # ==========================================
    def trigger_process(self, mode: str):
        if self.is_ai_active:
            threading.Thread(target=self.process_and_paste, args=(mode,), daemon=True).start()
        else:
            print("⚠️ โปรดเปิดใช้งานระบบ AI ก่อน!")

    def process_and_paste(self, mode: str):
        if not self._processing_lock.acquire(blocking=False):
            return
        try:
            print(f"🧠 กำลังคัดลอกและประมวลผล ({mode})...")

            # ปล่อยปุ่ม Modifier
            if "mouse" not in self.hotkeys[mode]:
                keyboard.release(self.hotkeys[mode])
            keyboard.release('ctrl')
            keyboard.release('alt')
            keyboard.release('shift')
            time.sleep(0.1)

            pyperclip.copy("")
            time.sleep(0.1)

            # Ctrl+A, Ctrl+C (ctypes สำหรับภาษาไทย)
            ctypes.windll.user32.keybd_event(0x11, 0, 0, 0)
            ctypes.windll.user32.keybd_event(0x41, 0, 0, 0)
            ctypes.windll.user32.keybd_event(0x41, 0, 2, 0)
            time.sleep(0.15)
            ctypes.windll.user32.keybd_event(0x43, 0, 0, 0)
            ctypes.windll.user32.keybd_event(0x43, 0, 2, 0)
            ctypes.windll.user32.keybd_event(0x11, 0, 2, 0)

            text = ""
            for _ in range(10):
                time.sleep(0.1)
                text = pyperclip.paste().strip()
                if text:
                    break

            if not text:
                print("⚠️ ไม่พบข้อความที่เลือก")
                return

            text = self._collapse_overspaced_thai(text)

            system_prompt = formal_instruction if mode == "formal" else transcript_instruction
            model_to_use  = self.formal_model  if mode == "formal" else self.raw_model

            # จำกัด completion tokens — งานจัดรูปความยาวผลลัพธ์ใกล้กับ input; ลดค่าใช้จ่าย output
            max_out = min(8192, max(512, int(len(text) * 1.5) + 400))

            response = client.chat.completions.create(
                model=model_to_use,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": text},
                ],
                temperature=0.1,
                max_tokens=max_out,
            )
            result = response.choices[0].message.content.strip().replace("-", " ")
            result = self._strip_special_chars(result)
            # ไม่เรียก _collapse_overspaced_thai ที่ผลลัพธ์ — จะลบช่องว่างระหว่างตัวอักษรไทยทุกคู่
            # ทำให้การจัดเว้นวรรคจากโมเดลหายไป (ดูเหมือน AI ไม่จัดคำ)

            pyperclip.copy(result)
            time.sleep(0.15)

            # Ctrl+V
            ctypes.windll.user32.keybd_event(0x11, 0, 0, 0)
            ctypes.windll.user32.keybd_event(0x56, 0, 0, 0)
            ctypes.windll.user32.keybd_event(0x56, 0, 2, 0)
            ctypes.windll.user32.keybd_event(0x11, 0, 2, 0)
            print("✅ ดำเนินการสำเร็จ!")

        except Exception as e:
            print(f"❌ Error: {e}")
        finally:
            if "mouse" not in self.hotkeys[mode]:
                keyboard.release(self.hotkeys[mode])
            keyboard.release('ctrl')
            self._processing_lock.release()

    def _strip_special_chars(self, text: str) -> str:
        """ลบอักขระพิเศษที่ AI อาจสร้างขึ้น"""
        for ch in ['"', "'", ':', '：', '(', ')']:
            text = text.replace(ch, '')
        return text

    def _collapse_overspaced_thai(self, text: str) -> str:
        """
        ลบช่องว่างระหว่างตัวอักษรในบล็อกไทยติดกัน (อาการถอดเสียง/ข้อความที่เว้นทุกคำ)
        คงช่องว่างคั่นไทย–เลข–ละติน–เครื่องหมายตามเดิม

        ใช้กับข้อความดิบก่อนส่งโมเดลจัดรูปแบบเท่านั้น — ห้ามใช้กับข้อความที่จัดเว้นวรรคแล้ว
        เพราะจะลบช่องว่างระหว่างคำไทยที่ถูกต้องด้วย
        """
        if not text:
            return text
        thai = r"[\u0E00-\u0E7F]"
        out = re.sub(rf"(?<={thai})\s+(?={thai})", "", text)
        return re.sub(r" +", " ", out).strip()

    def _is_transient_connection_error(self, e: Exception) -> bool:
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

    def _transcribe_audio_with_retry(self, prompt: str, audio_b64: str) -> str:
        """
        Retry OpenRouter call when intermittent network/provider errors happen.
        - Reuses the same audio bytes (no need to re-download).
        - Falls back to another audio model if the current one keeps failing.
        """
        # Try current model first, then a few fallbacks (dedup while keeping order)
        model_candidates = []
        if self.audio_model:
            model_candidates.append(self.audio_model)
        for m in OPENROUTER_AUDIO_MODELS:
            if m not in model_candidates:
                model_candidates.append(m)

        last_err: Exception | None = None
        for model_idx, model_name in enumerate(model_candidates[:3]):  # keep bounded
            # 3 attempts per model
            for attempt in range(1, 4):
                try:
                    if attempt > 1:
                        print(f"[🔁] Retry {attempt}/3 (model: {model_name})...")
                    return client.chat.completions.create(
                        model=model_name,
                        max_tokens=500,
                        temperature=0.2,
                        timeout=30,
                        messages=[{
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "input_audio", "input_audio": {"data": audio_b64, "format": "wav"}},
                            ]
                        }],
                    ).choices[0].message.content or ""
                except Exception as e:
                    last_err = e
                    transient = self._is_transient_connection_error(e)
                    if not transient:
                        raise

                    # Backoff with a bit of jitter
                    sleep_s = min(8.0, (2 ** (attempt - 1))) + random.random() * 0.4
                    print(f"[⚠️] Connection error: {e} — รอ {sleep_s:.1f}s แล้วลองใหม่")
                    time.sleep(sleep_s)

            # Model fallback (only if we still have candidates)
            if model_idx < 2:
                print(f"[🧩] เปลี่ยนโมเดลชั่วคราวเพื่อแก้ connection error: {model_name} -> {model_candidates[model_idx + 1]}")

        # If all retries failed
        raise last_err if last_err else RuntimeError("Unknown connection failure")

    # ==========================================
    # 8. DingTalk Voice Transcription
    # ==========================================
    def dingtalk_transcribe_and_paste(self):
        if not self.is_ai_active:
            print("⚠️ โปรดเปิดใช้งานระบบ AI ก่อน!")
            return
        if self.dingtalk_is_processing:
            print("⚠️ กำลังประมวลผลอยู่แล้ว รอสักครู่...")
            return

        self.dingtalk_is_processing = True
        try:
            print("\n[🎬] ดูดเสียงและวางข้อความ: เริ่มกระบวนการ...")

            keyboard.send("alt+8")
            print("[🚦] ส่งสัญญาณไฟแดง: ระงับบอทชั่วคราว...")

            keyboard.send("alt+s")
            print("[📡] ส่งสัญญาณดูดเสียง (Alt+S) ไปยัง Browser...")

            # รอไฟล์เสียงเสถียร (สูงสุด 15 วินาที)
            found = False
            stable_count = 0
            last_size    = 0
            for _ in range(75):
                if os.path.exists(DINGTALK_WAV):
                    current_size = os.path.getsize(DINGTALK_WAV)
                    if current_size > 0:
                        if current_size == last_size:
                            stable_count += 1
                            if stable_count >= 5:
                                found = True
                                break
                        else:
                            stable_count = 0
                        last_size = current_size
                time.sleep(0.2)

            if not found:
                print(f"⚠️ ไม่พบไฟล์เสียงที่ {DINGTALK_WAV} หรือไฟล์ยังไม่เสร็จ — ตรวจสอบ Extension ด้วย")
                return

            print("[📂] ไฟล์พร้อม! กำลังส่งให้ OpenRouter...")

            with open(DINGTALK_WAV, "rb") as f:
                audio_b64 = base64.b64encode(f.read()).decode("utf-8")

            PROMPT_WITH_RULES = DINGTALK_PROMPT + "\n- NO BRACKETS: ห้ามสร้างวงเล็บ () เด็ดขาด ลบวงเล็บทิ้งให้หมด"

            print(f"[🤖] กำลังส่งเสียงให้ AI ประมวลผล (โมเดล: {self.audio_model})...")
            content = self._transcribe_audio_with_retry(PROMPT_WITH_RULES, audio_b64)

            result_text = ' '.join((content or "").strip().split())
            result_text = re.sub(r'[()]', '', result_text)
            result_text = self._collapse_overspaced_thai(result_text)

            if result_text:
                pyperclip.copy(result_text)
                time.sleep(0.1)
                print("[⌨️] กำลังลบข้อความเก่าและวางข้อความใหม่...")

                ctypes.windll.user32.keybd_event(0x11, 0, 0, 0)
                ctypes.windll.user32.keybd_event(0x41, 0, 0, 0)
                ctypes.windll.user32.keybd_event(0x41, 0, 2, 0)
                ctypes.windll.user32.keybd_event(0x11, 0, 2, 0)
                time.sleep(0.1)
                ctypes.windll.user32.keybd_event(0x08, 0, 0, 0)
                ctypes.windll.user32.keybd_event(0x08, 0, 2, 0)
                time.sleep(0.1)
                ctypes.windll.user32.keybd_event(0x11, 0, 0, 0)
                ctypes.windll.user32.keybd_event(0x56, 0, 0, 0)
                ctypes.windll.user32.keybd_event(0x56, 0, 2, 0)
                ctypes.windll.user32.keybd_event(0x11, 0, 2, 0)
                print("🎉 ดูดเสียงและวางข้อความ (ดิบ) สำเร็จ!")

                settle = max(0.2, min(10.0, float(getattr(self, "dingtalk_formal_settle_delay", 1.0))))
                print(f"[⏳] รอ {settle:.1f} วิ แล้วส่ง Formal จัดช่องว่าง/รูปแบบ (เหมือนกดคีย์ลัด Formal)...")
                time.sleep(settle)
                self.process_and_paste("formal")
                print("🎉 ดูดเสียง → Formal วางข้อความครบแล้ว!")

                try: os.remove(DINGTALK_WAV)
                except Exception: pass
            else:
                print("⚠️ ไม่ได้ถอดเสียงออกมา — ลองใหม่อีกครั้ง")

        except Exception as e:
            print(f"❌ ดูดเสียงและวางข้อความ Error: {e}")
        finally:
            self.dingtalk_is_processing = False
            keyboard.send("alt+9")
            print("[🟢] ส่งสัญญาณไฟเขียว: บอทกลับมาทำงานได้!")

    # ==========================================
    # 9. ปิดโปรแกรม
    # ==========================================
    def quit_app(self):
        print("🔴 กำลังปิดโปรแกรม...")
        self.save_config()
        keyboard.unhook_all()
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
        self.destroy()
        os._exit(0)

    def on_window_close(self):
        self.quit_app()


if __name__ == "__main__":
    app = AITranscriberApp()
    app.mainloop()