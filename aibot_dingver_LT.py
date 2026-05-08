import os
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

# ==========================================
# ฟังก์ชันสำหรับจัดการ Path ของไฟล์ต่างๆ (ปลอดภัยสำหรับ .exe)
# ==========================================
def resource_path(relative_path):
    """หาตำแหน่งไฟล์เมื่อรันเป็น .exe (เช่น ไฟล์ไอคอน)"""
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# หาโฟลเดอร์ที่รันโปรแกรมอยู่ เพื่อสร้าง config.json ให้อยู่ที่เดียวกันเสมอ
if getattr(sys, 'frozen', False):
    application_path = os.path.dirname(sys.executable)
else:
    application_path = os.path.dirname(os.path.abspath(__file__))

CONFIG_FILE = os.path.join(application_path, "config.json")
RAW_FILE_NAME = os.path.basename(__file__)
CURRENT_VERSION = "2.7.1.3b"  # อัปเดตเวอร์ชันนี้ทุกครั้งที่มีการเปลี่ยนแปลงสำคัญ (รูปแบบ: Major.Minor.Patch.Build)

# ==========================================
# 1. การตั้งค่า API และ Prompt
# ==========================================
api_key = "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"
client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key.strip())
MODEL = "google/gemini-2.5-flash-lite"

# DingTalk Voice constants
OPENROUTER_AUDIO_MODEL = "google/gemini-3.1-flash-lite-preview"
DINGTALK_WAV = os.path.join(os.path.expanduser('~'), 'Downloads', 'dingtalk_temp.wav')
DINGTALK_PROMPT = """
You are a verbatim transcription engine. Write down EXACTLY what was spoken — word for word, in the ORIGINAL language it was spoken in.

## CRITICAL LANGUAGE RULE (Most Important):
- Speaker says Thai → write Thai  ← ห้ามแปลเป็นภาษาอื่น
- Speaker says English → write English
- Mixed Thai/English in same clip → preserve BOTH languages exactly as spoken
- NEVER translate Thai into English. NEVER translate English into Thai.
- ถ้าพูดภาษาไทย ต้องพิมพ์ภาษาไทย ห้ามแปลเป็นอังกฤษเด็ดขาด
- STRICT GENDER PARTICLES: ห้ามสลับเพศของคำลงท้ายเด็ดขาด! ถ้าเสียงคือ "ค่ะ/นะคะ/คะ" ต้องพิมพ์ "ค่ะ/นะคะ/คะ" ห้ามแก้เป็น "ครับ/นะครับ" (และในทางกลับกันด้วย)

## OUTPUT RULES:
- Single continuous paragraph — ห้ามขึ้นบรรทัดใหม่
- NO timestamps (00:00, 00:01 etc.) — ห้ามสร้าง timestamp
- Keep filler words verbatim (e.g., เอ่อ, อ่า, อืม, แบบว่า, ครับ, ค่ะ, นะคะ, นะครับ)
- Keep repeated words verbatim — ห้ามลบคำซ้ำ
- Start directly with the first spoken word — ห้ามมีคำนำหรืออธิบาย

## FORBIDDEN:
- Do NOT translate anything
- Do NOT summarize
- Do NOT change female particles (ค่ะ/นะคะ) to male particles (ครับ/นะครับ)
- Do NOT echo or repeat these instructions in the output

## กฎตัวเลขและจำนวน:
• แปลงจำนวนเป็นเลขอารบิก (0-9) ทั้งหมด
• NO FRACTIONS: ห้ามแปลงคำว่า "ครึ่ง" หรือ "เสี้ยว" เป็นเศษส่วน 1/2 หรือ 0.5 เด็ดขาด
• ห้ามแปลงคำถามจำนวน เช่น "กี่" เป็นตัวเลข
• "ปี ค.ศ. หนึ่งเก้าศูนย์เก้า" ต้องเขียนเป็น "ปี ค.ศ. 1990" ห้ามตัด ค.ศ. ออก
"""
formal_instruction = """
Your ONLY goal is to insert standard spaces (เว้นวรรค) between clauses and distinct ideas to improve readability.

CRITICAL RULES (STRICT VERBATIM):
PRESERVE EVERYTHING: You MUST keep every single word from the original text.
KEEP FILLERS & REPETITIONS: You MUST keep all filler words (e.g., เอ่อ, อ่า, แบบว่า) and stuttered/repeated words (e.g., มัน มัน, ไป ไป). Do NOT clean up the grammar or summarize.
ONLY add space characters (' '). Do not change or remove any letters.

EXAMPLE:
Input: คือเอ่อแบบว่าเราเราต้องไปที่นั่นก่อนนะครับถึงจะรู้ว่ามันมันทำงานยังไง
Output: คือ เอ่อ แบบว่า เราเราต้องไปที่นั่นก่อนนะครับ ถึงจะรู้ว่า มันมันทำงานยังไง

Format the following text according to these rules:
"""

# ==========================================
# 2. คลาสสำหรับ Redirect คำสั่ง Print (แบบแยกสี)
# ==========================================
class TextboxRedirector:
    def __init__(self, app, textbox):
        self.app = app
        self.textbox = textbox

    def write(self, string):
        # ถ้าเป็นแค่การขึ้นบรรทัดใหม่ ไม่ต้องใส่แท็กสี
        if not string.strip():
            self.app.after(0, self._write_thread_safe, string, None)
            return

        # ตรวจสอบอีโมจิหรือคำ เพื่อกำหนดสี
        tag = "default"
        if any(kw in string for kw in ["❌", "Error", "🔴"]):
            tag = "error"
        elif any(kw in string for kw in ["✅", "🟢", "🚀"]):
            tag = "success"
        elif any(kw in string for kw in ["⚠️", "⏳", "⌛"]):
            tag = "warning"
        elif any(kw in string for kw in ["📌", "🧹", "🧠"]):
            tag = "info"

        self.app.after(0, self._write_thread_safe, string, tag)

    def _write_thread_safe(self, string, tag):
        self.textbox.configure(state="normal")
        if tag:
            self.textbox.insert("end", string, tag)
        else:
            self.textbox.insert("end", string)
        self.textbox.see("end")
        self.textbox.configure(state="disabled")

    def flush(self): pass

# ==========================================
# 3. คลาสหลักสำหรับจัดการแอปและ UI
# ==========================================
class AITranscriberApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("AI Transcriber Pro")
        self.geometry("900x550")
        self.resizable(False, False)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")
        
        # ใส่ไอคอนถ้ามี
        if os.path.exists(resource_path("app_icon.ico")):
            self.iconbitmap(resource_path("app_icon.ico"))

        self.protocol("WM_DELETE_WINDOW", self.quit_app)

        self.is_ai_active = True
        self.terminal_visible = True
        self.is_pinned = False 
        self._processing_lock = threading.Lock()
        
        # คีย์ลัดเริ่มต้น (กรณีไม่มี config)
        self.hotkeys = {"formal": "f9", "dingtalk_voice": "f11"}
        self.listening_for = None
        self._keyboard_listen_active = False  # flag ป้องกัน apply ซ้ำเมื่อเปลี่ยน key
        self.voice_suppress = True  # suppress เฉพาะปุ่ม Voice Typing เท่านั้น
        self.dingtalk_is_processing = False  # lock สำหรับ DingTalk Voice
        
        self.load_config() # โหลดการตั้งค่าเก่าจากไฟล์ config.json
        self.setup_ui()
        self.register_all_hotkeys()
        
        threading.Thread(target=self._mouse_polling_daemon, daemon=True).start()
        
        print("🚀 ระบบพร้อมทำงานแล้ว!")
        
        self._cleanup_old_exe()
        
    def _cleanup_old_exe(self):
        """ระบบจัดการลบไฟล์ .exe ตัวเก่าที่ถูกเปลี่ยนชื่อทิ้งไป"""
        if not getattr(sys, 'frozen', False):
            return
            
        def delete_loop():
            # 1. หน่วงเวลาเริ่มต้น 3 วินาทีก่อนเริ่มลบ เพื่อรอให้โปรแกรมเก่าปิดสนิท และ Antivirus ปล่อยไฟล์
            time.sleep(3) 
            
            # 2. เพิ่มความอดทน: วนลูปพยายามลบ 15 ครั้ง (ครั้งละ 2 วินาที = พยายามสูงสุด 30 วินาที)
            for _ in range(15):
                old_files_exist = False
                for file_name in os.listdir(application_path):
                    if file_name.endswith(".old"):
                        old_files_exist = True
                        file_path = os.path.join(application_path, file_name)
                        try:
                            # ปลดล็อกสิทธิ์ Read-only (เผื่อติดสิทธิ์จำกัดของ Windows)
                            os.chmod(file_path, 0o777)
                            # สั่งลบไฟล์
                            os.remove(file_path)
                            print(f"🧹 ลบไฟล์เวอร์ชันเก่าทิ้งสำเร็จ: {file_name}")
                        except Exception:
                            pass # ยังลบไม่ได้ ไม่เป็นไร เดี๋ยวรอรอบหน้า
                
                # ถ้าสแกนแล้วไม่เจอไฟล์ .old เหลืออยู่เลย ให้ออกจากลูป (จบการทำงานเธรด)
                if not old_files_exist:
                    break
                    
                # รอก่อน 2 วินาที แล้วค่อยวนไปลองลบใหม่
                time.sleep(2)
                
        # เปิด Thread แยกเพื่อไม่ให้ UI โปรแกรมค้างตอนรอ
        threading.Thread(target=delete_loop, daemon=True).start()
    # ==========================================
    # ระบบโหลดและบันทึกการตั้งค่า (Save/Load Config)
    # ==========================================
    def load_config(self):
        """โหลดคีย์ลัดจากไฟล์ config.json ถ้ามี"""
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    for k in self.hotkeys:
                        if k in saved:
                            self.hotkeys[k] = saved[k]
                    if "voice_suppress" in saved:
                        self.voice_suppress = bool(saved["voice_suppress"])
            except Exception as e:
                print(f"⚠️ เกิดปัญหาการโหลดการตั้งค่า: {e}")

    def save_config(self):
        """บันทึกคีย์ลัดลงไฟล์ config.json"""
        try:
            data = dict(self.hotkeys)
            data["voice_suppress"] = self.voice_suppress
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"❌ ไม่สามารถบันทึกการตั้งค่าได้: {e}")

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











    # ==========================================
    # การสร้างหน้าต่าง (UI)
    # ==========================================
    def setup_ui(self):
        self.main_container = ctk.CTkFrame(self, fg_color="transparent")
        self.main_container.pack(fill="both", expand=True, padx=15, pady=15)

        # === ฝั่งซ้าย: แผงควบคุม ===
        self.left_frame = ctk.CTkFrame(self.main_container, width=380)
        self.left_frame.pack(side="left", fill="both", padx=(0, 10))
        self.left_frame.pack_propagate(False)

        # --- Top Bar (แถบบนสุด) ---
        self.top_bar = ctk.CTkFrame(self.left_frame, fg_color="transparent")
        self.top_bar.pack(fill="x", pady=(20, 5), padx=20)
        
        # จัดกลุ่มฝั่งซ้าย (ชื่อโปรแกรม + เวอร์ชัน)
        self.header_frame = ctk.CTkFrame(self.top_bar, fg_color="transparent")
        self.header_frame.pack(side="left", fill="x", expand=True)
        
        self.header = ctk.CTkLabel(self.header_frame, text="AI TEXT TOOLS", font=ctk.CTkFont(size=22, weight="bold"))
        self.header.pack(anchor="w")
        


        # จัดกลุ่มฝั่งขวา (ปุ่มเรียงจากขวามาซ้าย)
        self.fold_btn = ctk.CTkButton(
            self.top_bar, text="◀ พับ", width=50, height=28,
            fg_color="#34495e", hover_color="#2c3e50", font=ctk.CTkFont(weight="bold"),
            command=self.toggle_terminal
        )
        self.fold_btn.pack(side="right")

        self.pin_btn = ctk.CTkButton(
            self.top_bar, text="📌", width=30, height=28,
            fg_color="#34495e", hover_color="#2c3e50", font=ctk.CTkFont(size=14),
            command=self.toggle_topmost
        )
        self.pin_btn.pack(side="right", padx=(5, 5))


        # --------------------------

        self.status_container = ctk.CTkFrame(self.left_frame, height=60, corner_radius=10)
        self.status_container.pack(fill="x", padx=30, pady=10)
        self.status_label = ctk.CTkLabel(self.status_container, text="SYSTEM ACTIVE", font=ctk.CTkFont(size=16, weight="bold"), text_color="#2ecc71")
        self.status_label.place(relx=0.5, rely=0.5, anchor="center")

        self.switch_var = ctk.BooleanVar(value=True)
        self.toggle_switch = ctk.CTkSwitch(
            self.left_frame, text="เปิดใช้งานระบบ AI", variable=self.switch_var, command=self.on_status_change, font=ctk.CTkFont(size=13)
        )
        self.toggle_switch.pack(pady=10)

        self.hotkey_frame = ctk.CTkFrame(self.left_frame, fg_color="transparent")
        self.hotkey_frame.pack(fill="x", padx=20, pady=5)
        self.hotkey_labels, self.hotkey_buttons = {}, {}
        self.add_hotkey_row("จัดการช่องว่างอักษร:", "formal", 0)
        self.add_hotkey_row("🎙 DingTalk Voice (OpenRouter):", "dingtalk_voice", 1)

        self.control_btn_frame = ctk.CTkFrame(self.left_frame, fg_color="transparent")
        self.control_btn_frame.pack(side="bottom", fill="x", pady=20, padx=20)
        self.exit_btn = ctk.CTkButton(self.control_btn_frame, text="ออกจากโปรแกรม", fg_color="#c0392b", hover_color="#e74c3c", command=self.quit_app)
        self.exit_btn.pack(fill="x", pady=5)


        # === ฝั่งขวา: Terminal Log ===
        self.right_frame = ctk.CTkFrame(self.main_container)
        self.right_frame.pack(side="right", fill="both", expand=True)

        self.term_header = ctk.CTkFrame(self.right_frame, fg_color="transparent")
        self.term_header.pack(fill="x", padx=15, pady=(15, 5))
        ctk.CTkLabel(self.term_header, text="TERMINAL LOG", font=ctk.CTkFont(size=12, weight="bold"), text_color="gray").pack(side="left")
        ctk.CTkButton(self.term_header, text="Clear Log", width=70, height=24, fg_color="#34495e", hover_color="#2c3e50", command=self.clear_terminal).pack(side="right")

        # กล่องข้อความ Terminal
        self.log_console = ctk.CTkTextbox(self.right_frame, font=ctk.CTkFont(family="Consolas", size=12), fg_color="#1a1a1a")
        self.log_console.pack(padx=15, pady=(0, 15), fill="both", expand=True)
        self.log_console.configure(state="disabled")

        # --- ลงทะเบียนแท็กสีให้ Terminal ---
        self.log_console.tag_config("error", foreground="#ff4d4d")    # สีแดง
        self.log_console.tag_config("success", foreground="#2ecc71")  # สีเขียว
        self.log_console.tag_config("warning", foreground="#f1c40f")  # สีเหลือง
        self.log_console.tag_config("info", foreground="#3498db")     # สีฟ้า
        self.log_console.tag_config("default", foreground="#ecf0f1")  # สีขาว (ปกติ)

        sys.stdout = TextboxRedirector(self, self.log_console)
        sys.stderr = TextboxRedirector(self, self.log_console)

    def add_hotkey_row(self, label_text, action_key, row):
        self.hotkey_frame.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(self.hotkey_frame, text=label_text).grid(row=row, column=0, padx=10, pady=8, sticky="w")
        val_lbl = ctk.CTkLabel(self.hotkey_frame, text=self.hotkeys[action_key].upper(), font=ctk.CTkFont(weight="bold"), text_color="#1abc9c")
        val_lbl.grid(row=row, column=1, padx=10, pady=8, sticky="e")
        self.hotkey_labels[action_key] = val_lbl

        btn = ctk.CTkButton(self.hotkey_frame, text="เปลี่ยน", width=50, height=24, command=lambda k=action_key: self.start_listening(k))
        btn.grid(row=row, column=2, padx=10, pady=8)
        self.hotkey_buttons[action_key] = btn

        # เพิ่มปุ่ม Suppress toggle ใต้ DingTalk Voice
        if action_key == "dingtalk_voice":
            suppress_color = "#e74c3c" if self.voice_suppress else "#34495e"
            suppress_text = "⛔ Suppress" if self.voice_suppress else "✅ No Suppress"
            self.suppress_btn = ctk.CTkButton(
                self.hotkey_frame, text=suppress_text, width=100, height=24,
                fg_color=suppress_color, hover_color="#2c3e50",
                command=self.toggle_voice_suppress
            )
            self.suppress_btn.grid(row=row + 1, column=0, columnspan=4, padx=10, pady=(0, 6))

    # ==========================================
    # 4. ฟังก์ชันจัดการ UI
    # ==========================================
    def toggle_topmost(self):
        self.is_pinned = not self.is_pinned
        self.attributes("-topmost", self.is_pinned)
        if self.is_pinned:
            self.pin_btn.configure(fg_color="#e74c3c", hover_color="#c0392b")
            print("📌 ปักหมุดหน้าต่างไว้บนสุดแล้ว")
        else:
            self.pin_btn.configure(fg_color="#34495e", hover_color="#2c3e50")
            print("📌 ยกเลิกการปักหมุด")

    def on_status_change(self):
        self.is_ai_active = self.switch_var.get()
        if self.is_ai_active:
            self.status_label.configure(text="SYSTEM ACTIVE", text_color="#2ecc71")
            self.status_container.configure(fg_color="#1e272e")
            print("🟢 ระบบ AI ทำงาน")
        else:
            self.status_label.configure(text="SYSTEM PAUSED", text_color="#e74c3c")
            self.status_container.configure(fg_color="#2c3e50")
            print("🔴 หยุดทำงานชั่วคราว")

    def toggle_terminal(self):
        if self.terminal_visible:
            self.right_frame.pack_forget()
            self.geometry("420x550")
            self.fold_btn.configure(text="▶ กาง")
        else:
            self.right_frame.pack(side="right", fill="both", expand=True)
            self.geometry("900x550")
            self.fold_btn.configure(text="◀ พับ")
        self.terminal_visible = not self.terminal_visible

    def clear_terminal(self):
        self.log_console.configure(state="normal")
        self.log_console.delete("1.0", "end")
        self.log_console.configure(state="disabled")
        print("🧹 ล้างประวัติ Terminal แล้ว")

    # ==========================================
    # 5. ระบบ Core (Mouse & Keyboard Hooks)
    # ==========================================
    def register_all_hotkeys(self):
        keyboard.unhook_all()
        # [แก้ไข] ปุ่ม raw/formal/toggle/record ใช้ suppress=True เสมอ
        # เพื่อป้องกันไม่ให้ปุ่มที่ตั้งค่าไว้ส่ง keypress ต่อไปยัง Windows (เช่น ลดเสียง)
        for action, key in self.hotkeys.items():
            # ป้องกันบั๊ก: ถ้าค่าคีย์เป็นค่าว่าง หรือไม่มีตัวอักษรเลย ให้ข้ามการลงทะเบียนไปเลย
            if not key or not str(key).strip():
                continue
                
            if "mouse" not in str(key).lower():
                try:
                    # แยก combo key (เช่น "ctrl+d" -> ["ctrl", "d"])
                    key_parts = str(key).lower().split('+')
                    
                    # ถ้า combo key มีหลายส่วน ให้ใช้ keyboard.on_combination
                    if len(key_parts) > 1:
                        # สร้าง lambda ที่จับ combo key
                        if action == "formal":
                            keyboard.add_hotkey(key, lambda: self.trigger_process("formal"), suppress=True)
                        elif action == "dingtalk_voice":
                            keyboard.add_hotkey(key, lambda: threading.Thread(target=self.dingtalk_transcribe_and_paste, daemon=True).start(), suppress=True)
                    else:
                        # คีย์เดี่ยว ใช้วิธีเดิม
                        if action == "formal":
                            keyboard.hook_key(key, lambda e: self.trigger_process("formal") if e.event_type == keyboard.KEY_DOWN else None, suppress=True)
                        elif action == "dingtalk_voice":
                            keyboard.hook_key(key, lambda e: threading.Thread(target=self.dingtalk_transcribe_and_paste, daemon=True).start() if e.event_type == keyboard.KEY_DOWN else None, suppress=True)
                except ValueError:
                    print(f"⚠️ ไม่สามารถลงทะเบียนคีย์ '{key}' ได้ กรุณาเปลี่ยนปุ่มใหม่")

    def _mouse_polling_daemon(self):
        last_m4, last_m5 = False, False
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
            self._keyboard_listen_active = False  # ปิด thread keyboard ไม่ให้ apply ซ้ำ
            self._apply_new_hotkey(action, btn_name)
        else:
            for act, key in self.hotkeys.items():
                if key.lower() == btn_name:
                    if act == "dingtalk_voice": threading.Thread(target=self.dingtalk_transcribe_and_paste, daemon=True).start()
                    else: self.trigger_process(act)

    def toggle_voice_suppress(self):
        """สลับ suppress mode สำหรับปุ่ม DingTalk Voice"""
        self.voice_suppress = not self.voice_suppress
        self.save_config()
        self.register_all_hotkeys()
        if self.voice_suppress:
            self.suppress_btn.configure(text="⛔ Suppress", fg_color="#e74c3c")
            print("⛔ Suppress เปิดอยู่: ปุ่ม DingTalk Voice จะไม่ส่งคีย์ออก")
        else:
            self.suppress_btn.configure(text="✅ No Suppress", fg_color="#34495e")
            print("✅ Suppress ปิดอยู่: ปุ่ม DingTalk Voice จะส่งคีย์ออกตามปกติ")

    def start_listening(self, action_key):
        # ยกเลิก thread เดิมถ้ายังรอค้างอยู่
        self._keyboard_listen_active = False
        keyboard.unhook_all()
        for btn in self.hotkey_buttons.values(): btn.configure(state="disabled")
        self.hotkey_buttons[action_key].configure(text="...")
        
        self.listening_for = action_key
        self._keyboard_listen_active = True  # flag สำหรับ thread ใหม่
        print(f"⏳ รอรับคีย์ลัดใหม่... (กดคีย์บอร์ด หรือ Mouse 4/5 ได้เลย)")
        
        threading.Thread(target=self._record_keyboard_hotkey, args=(action_key,), daemon=True).start()

    def _record_keyboard_hotkey(self, action_key):
        time.sleep(0.2)
        result = []
        hook_ref = [None]
        pressed_keys = set()  # เก็บคีย์ที่กดอยู่

        def on_key_event(event):
            if not result:
                if event.event_type == keyboard.KEY_DOWN:
                    pressed_keys.add(event.name.lower())
                    # หากมีคีย์ modifier (ctrl, alt, shift) + คีย์ปกติ ให้บันทึก
                    modifiers = [k for k in pressed_keys if k in {'ctrl', 'alt', 'shift', 'left ctrl', 'right ctrl', 'left alt', 'right alt', 'left shift', 'right shift'}]
                    main_keys = [k for k in pressed_keys if k not in {'ctrl', 'alt', 'shift', 'left ctrl', 'right ctrl', 'left alt', 'right alt', 'left shift', 'right shift'}]
                    
                    # หากมีคีย์หลักที่ไม่ใช่ modifier ให้บันทึก
                    if main_keys and len(main_keys) > 0:
                        # สร้างชุดคีย์ (เช่น "ctrl+d")
                        normalized_mods = []
                        if any(m.startswith('ctrl') for m in modifiers):
                            normalized_mods.append('ctrl')
                        if any(m.startswith('alt') for m in modifiers):
                            normalized_mods.append('alt')
                        if any(m.startswith('shift') for m in modifiers):
                            normalized_mods.append('shift')
                        
                        combo = '+'.join(normalized_mods + main_keys) if normalized_mods else main_keys[0]
                        result.append(combo)
                        if hook_ref[0]:
                            keyboard.unhook(hook_ref[0])
                
                elif event.event_type == keyboard.KEY_UP:
                    pressed_keys.discard(event.name.lower())

        hook_ref[0] = keyboard.hook(on_key_event, suppress=True)

        timeout = 30
        elapsed = 0
        while not result and elapsed < timeout:
            time.sleep(0.05)
            elapsed += 0.05

        if hook_ref[0]:
            try:
                keyboard.unhook(hook_ref[0])
            except Exception:
                pass

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
        # บันทึกคีย์ใหม่เข้า Dictionary
        self.hotkeys[action_key] = new_key.lower()
        
        # บันทึกลงไฟล์ config.json ทันที
        self.save_config()
        
        # อัปเดต UI
        self.hotkey_labels[action_key].configure(text=new_key.upper())
        for btn in self.hotkey_buttons.values(): btn.configure(state="normal", text="เปลี่ยน")
        self.register_all_hotkeys()
        print(f"✅ บันทึกคีย์ลัดใหม่สำเร็จ: {new_key.upper()}")

    # ==========================================
    # 6. ประมวลผลข้อความ
    # ==========================================
    def trigger_process(self, mode: str):
        if self.is_ai_active:
            threading.Thread(target=self.process_and_paste, args=(mode,), daemon=True).start()
        else:
            print("⚠️ โปรดเปิดใช้งานระบบ AI ก่อน!")

    def process_and_paste(self, mode: str):
        if not self._processing_lock.acquire(blocking=False): return
        try:
            print(f"🧠 กำลังคัดลอกและประมวลผล ({mode})...")
            
            # --- 1. บังคับปล่อยปุ่มที่กดอยู่และปุ่ม Modifier ทั้งหมด ---
            if "mouse" not in self.hotkeys[mode]:
                keyboard.release(self.hotkeys[mode])
            keyboard.release('ctrl')
            keyboard.release('alt')
            keyboard.release('shift')
            time.sleep(0.1) # [สำคัญ] ให้เวลา Windows 0.1 วิ ในการเคลียร์สถานะปุ่ม
            # --------------------------------------------------------

            # 2. ล้าง Clipboard ก่อนเริ่ม
            pyperclip.copy("") 
            time.sleep(0.1)

            # 3. สั่งเลือกทั้งหมดและคัดลอก (ใช้ ctypes แก้บั๊กภาษาไทย)
            ctypes.windll.user32.keybd_event(0x11, 0, 0, 0) # กด Ctrl
            ctypes.windll.user32.keybd_event(0x41, 0, 0, 0) # กด A
            ctypes.windll.user32.keybd_event(0x41, 0, 2, 0) # ปล่อย A
            time.sleep(0.15)
            ctypes.windll.user32.keybd_event(0x43, 0, 0, 0) # กด C
            ctypes.windll.user32.keybd_event(0x43, 0, 2, 0) # ปล่อย C
            ctypes.windll.user32.keybd_event(0x11, 0, 2, 0) # ปล่อย Ctrl
            
            # 4. รอข้อมูลเข้า Clipboard
            text = ""
            for _ in range(10):
                time.sleep(0.1)
                text = pyperclip.paste().strip()
                if text: break 
            
            if not text:
                print("⚠️ ไม่พบข้อความที่เลือก")
                return

            # 5. ส่งให้ AI ประมวลผล
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "system", "content": formal_instruction}, {"role": "user", "content": text}],
                temperature=0.1
            )
            result = response.choices[0].message.content.strip().replace("-", " ")
            result = self._strip_special_chars(result)
            
            # 6. วางผลลัพธ์
            pyperclip.copy(result)
            time.sleep(0.15)
            
            # 6. วางผลลัพธ์ (ใช้ ctypes แก้บั๊กภาษาไทย)
            ctypes.windll.user32.keybd_event(0x11, 0, 0, 0) # กด Ctrl
            ctypes.windll.user32.keybd_event(0x56, 0, 0, 0) # กด V
            ctypes.windll.user32.keybd_event(0x56, 0, 2, 0) # ปล่อย V
            ctypes.windll.user32.keybd_event(0x11, 0, 2, 0) # ปล่อย Ctrl
            print("✅ ดำเนินการสำเร็จ!")
            
        except Exception as e: 
            print(f"❌ Error: {e}")
        finally: 
            # การันตีการคืนค่า ไม่ว่าจะพังหรือสำเร็จ
            if "mouse" not in self.hotkeys[mode]:
                keyboard.release(self.hotkeys[mode])
            keyboard.release('ctrl')
            self._processing_lock.release()

    # ==========================================
    # 7. ฟังก์ชันช่วยเหลือ
    # ==========================================
    def _strip_special_chars(self, text: str) -> str:
        """ลบอักขระพิเศษที่ AI อาจสร้างขึ้น: " ' : ： ( )"""
        for ch in ['"', "'", ':', '：', '(', ')']:
            text = text.replace(ch, '')
        return text

    # ==========================================
    # 9. DingTalk Voice Auto-Paste (OpenRouter)
    # ==========================================
    def dingtalk_transcribe_and_paste(self):
        """ดูดไฟล์เสียงจาก DingTalk Extension แล้วถอดเสียงด้วย OpenRouter วางอัตโนมัติ"""
        if self.dingtalk_is_processing:
            print("⚠️ กำลังประมวลผลอยู่แล้ว รอสักครู่...")
            return

        self.dingtalk_is_processing = True
        try:
            print("\n[🎬] DingTalk Voice: เริ่มกระบวนการ...")
            
            # 🔥 1. ส่งสัญญาณ "ไฟแดง" ให้ Extension หยุดกด Accept (Alt + 8)
            keyboard.send("alt+8")
            print("[🚦] ส่งสัญญาณไฟแดง: ระงับบอทชั่วคราว...")

            # 2. สั่ง Extension ดูดเสียง
            keyboard.send("alt+s")
            print("[📡] ส่งสัญญาณดูดเสียง (Alt+S) ไปยัง Browser...")

            # 3. รอไฟล์เสียงโหลดเสร็จ (สูงสุด 15 วินาที และเช็คว่าไฟล์เสร็จแล้ว)
            found = False
            max_wait = 150  # 15 วินาที (75 * 0.2)
            stable_count = 0
            last_size = 0
            
            for i in range(max_wait):
                if os.path.exists(DINGTALK_WAV):
                    current_size = os.path.getsize(DINGTALK_WAV)
                    if current_size > 0:  # มีข้อมูลแล้ว
                        if current_size == last_size:
                            stable_count += 1
                            if stable_count >= 5:  # เสถียร 1 วินาที (5 * 0.2)
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

            # อัปเดต Prompt ย้ำเรื่องห้ามมีวงเล็บ
            PROMPT_WITH_RULES = DINGTALK_PROMPT + "\n- NO BRACKETS: ห้ามสร้างวงเล็บ () เด็ดขาด ลบวงเล็บทิ้งให้หมด"

            print("[🤖] กำลังส่งเสียงให้ AI ประมวลผล...")
            response = client.chat.completions.create(
                model=OPENROUTER_AUDIO_MODEL,
                max_tokens=500,
                temperature=0.2,
                timeout=30,  # เพิ่ม timeout 30 วินาทีสำหรับการประมวลผลเสียง
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": PROMPT_WITH_RULES},
                            {"type": "input_audio", "input_audio": {"data": audio_b64, "format": "wav"}}
                        ]
                    }
                ]
            )

            result_text = ' '.join(response.choices[0].message.content.strip().split())

            # 🔥 ใช้ Python ลบวงเล็บทิ้งแบบถอนรากถอนโคน (ชัวร์ 100%)
            import re
            result_text = re.sub(r'[()]', '', result_text)

            if result_text:
                pyperclip.copy(result_text)
                time.sleep(0.1)
                print("[⌨️] กำลังลบข้อความเก่าและวางข้อความใหม่...")
                
                ctypes.windll.user32.keybd_event(0x11, 0, 0, 0)  # Ctrl down
                ctypes.windll.user32.keybd_event(0x41, 0, 0, 0)  # A down
                ctypes.windll.user32.keybd_event(0x41, 0, 2, 0)  # A up
                ctypes.windll.user32.keybd_event(0x11, 0, 2, 0)  # Ctrl up
                time.sleep(0.1)
                ctypes.windll.user32.keybd_event(0x08, 0, 0, 0)  # Backspace
                ctypes.windll.user32.keybd_event(0x08, 0, 2, 0)
                time.sleep(0.1)
                ctypes.windll.user32.keybd_event(0x11, 0, 0, 0)  # Ctrl down
                ctypes.windll.user32.keybd_event(0x56, 0, 0, 0)  # V down
                ctypes.windll.user32.keybd_event(0x56, 0, 2, 0)  # V up
                ctypes.windll.user32.keybd_event(0x11, 0, 2, 0)  # Ctrl up
                print("🎉 DingTalk Voice สำเร็จ!")
                
                try: os.remove(DINGTALK_WAV)
                except Exception: pass
            else:
                print("⚠️ ไม่ได้ถอดเสียงออกมา — ลองใหม่อีกครั้ง")

        except Exception as e:
            print(f"❌ DingTalk Voice Error: {e}")
        finally:
            self.dingtalk_is_processing = False
            
            # 🔥 จบงาน! ส่งสัญญาณ "ไฟเขียว" ให้ Extension ทำงานต่อได้ (Alt + 9)
            keyboard.send("alt+9")
            print("[🟢] ส่งสัญญาณไฟเขียว: บอทกลับมาทำงานได้!")

    def quit_app(self):
        print("🔴 กำลังปิดโปรแกรม...")
        self.save_config() # บันทึกอีกรอบเพื่อความมั่นใจ
        keyboard.unhook_all()
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
        self.destroy()
        os._exit(0)

if __name__ == "__main__":
    app = AITranscriberApp()
    app.mainloop()