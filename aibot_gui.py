import sys
import customtkinter as ctk
from tkinter import messagebox

# ==========================================
# aibot_gui.py — UI Layer ของ AI Transcriber
# ==========================================
# ไฟล์นี้รับผิดชอบเฉพาะการสร้างและจัดการ UI
# Logic ทั้งหมดอยู่ใน aibot_dingver.py


class TextboxRedirector:
    """Redirect stdout/stderr ไปยัง CTkTextbox พร้อมระบบสี"""

    def __init__(self, app, textbox):
        self.app = app
        self.textbox = textbox

    def write(self, string):
        if not string.strip():
            self.app.after(0, self._write_thread_safe, string, None)
            return

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

    def flush(self):
        pass


class AppUI:
    """
    Mixin สำหรับ UI — ใช้ผ่าน multiple inheritance กับ AITranscriberApp
    สมมติว่า self มี attributes ทั้งหมดที่ Logic ต้องการ
    """

    # ==========================================
    # setup หน้าต่างหลัก
    # ==========================================
    def setup_window(self, resource_path_fn):
        """ตั้งค่าหน้าต่างหลักก่อน setup_ui"""
        import os
        self.title("AI Transcriber Pro")
        self.geometry("900x550")
        self.resizable(False, False)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        if os.path.exists(resource_path_fn("app_icon.ico")):
            self.iconbitmap(resource_path_fn("app_icon.ico"))

        self.protocol("WM_DELETE_WINDOW", self.quit_app)

    # ==========================================
    # สร้าง UI ทั้งหมด
    # ==========================================
    def setup_ui(self):
        self.main_container = ctk.CTkFrame(self, fg_color="transparent")
        self.main_container.pack(fill="both", expand=True, padx=15, pady=15)

        self._build_left_panel()
        self._build_right_panel()

    # ==========================================
    # ฝั่งซ้าย: แผงควบคุม
    # ==========================================
    def _build_left_panel(self):
        self.left_frame = ctk.CTkFrame(self.main_container, width=380)
        self.left_frame.pack(side="left", fill="both", padx=(0, 10))
        self.left_frame.pack_propagate(False)

        self._build_top_bar()
        self._build_status_bar()
        self._build_hotkey_rows()

    def _build_top_bar(self):
        from aibot_dingver import CURRENT_VERSION

        self.top_bar = ctk.CTkFrame(self.left_frame, fg_color="transparent")
        self.top_bar.pack(fill="x", pady=(20, 5), padx=20)

        # ฝั่งซ้าย: ชื่อโปรแกรม + เวอร์ชัน
        self.header_frame = ctk.CTkFrame(self.top_bar, fg_color="transparent")
        self.header_frame.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(
            self.header_frame, text="AI TEXT TOOLS",
            font=ctk.CTkFont(size=22, weight="bold")
        ).pack(anchor="w")

        self.update_status_label = ctk.CTkLabel(
            self.header_frame, text=f"เวอร์ชัน {CURRENT_VERSION}",
            font=ctk.CTkFont(size=12), text_color="#bdc3c7"
        )
        self.update_status_label.pack(anchor="w")

        # ฝั่งขวา: ปุ่ม (เรียงจากขวา)
        self.fold_btn = ctk.CTkButton(
            self.top_bar, text="◀ พับ", width=50, height=28,
            fg_color="#34495e", hover_color="#2c3e50",
            font=ctk.CTkFont(weight="bold"),
            command=self.toggle_terminal
        )
        self.fold_btn.pack(side="right")

        self.pin_btn = ctk.CTkButton(
            self.top_bar, text="📌", width=30, height=28,
            fg_color="#34495e", hover_color="#2c3e50",
            font=ctk.CTkFont(size=14),
            command=self.toggle_topmost
        )
        self.pin_btn.pack(side="right", padx=(5, 5))

        self.update_btn = ctk.CTkButton(
            self.top_bar, text="🔄 อัปเดต", width=65, height=28,
            fg_color="#2980b9", hover_color="#3498db",
            font=ctk.CTkFont(size=12, weight="bold"),
            command=self.check_for_updates
        )
        self.update_btn.pack(side="right")

    def _build_status_bar(self):
        self.status_container = ctk.CTkFrame(self.left_frame, height=60, corner_radius=10)
        self.status_container.pack(fill="x", padx=30, pady=10)
        self.status_label = ctk.CTkLabel(
            self.status_container, text="SYSTEM ACTIVE",
            font=ctk.CTkFont(size=16, weight="bold"), text_color="#2ecc71"
        )
        self.status_label.place(relx=0.5, rely=0.5, anchor="center")

        self.switch_var = ctk.BooleanVar(value=True)
        self.toggle_switch = ctk.CTkSwitch(
            self.left_frame, text="เปิดใช้งานระบบ AI",
            variable=self.switch_var, command=self.on_status_change,
            font=ctk.CTkFont(size=13)
        )
        self.toggle_switch.pack(pady=10)

    def _build_hotkey_rows(self):
        self.hotkey_frame = ctk.CTkFrame(self.left_frame, fg_color="transparent")
        self.hotkey_frame.pack(fill="x", padx=20, pady=5)
        self.hotkey_labels = {}
        self.hotkey_buttons = {}

        self.add_hotkey_row("โหมดจัด Format ข้อความ:", "raw",           row=0)
        # row 1: dropdown raw
        self.add_hotkey_row("จัดการช่องว่างอักษร:",       "formal",        row=2)
        # row 3: dropdown formal
        self.add_hotkey_row("Voice Typing:",               "voice_typing",  row=4)
        self.add_hotkey_row("🎙 ดูดเสียงและวางข้อความ:",  "dingtalk_voice", row=5)
        # row 6: dropdown dingtalk

    # ==========================================
    # แถว Hotkey แต่ละแถว
    # ==========================================
    def add_hotkey_row(self, label_text, action_key, row):
        from aibot_dingver import OPENROUTER_AUDIO_MODELS, OPENROUTER_TEXT_MODELS

        self.hotkey_frame.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(self.hotkey_frame, text=label_text).grid(
            row=row, column=0, padx=10, pady=8, sticky="w"
        )
        val_lbl = ctk.CTkLabel(
            self.hotkey_frame,
            text=self.hotkeys[action_key].upper(),
            font=ctk.CTkFont(weight="bold"), text_color="#1abc9c"
        )
        val_lbl.grid(row=row, column=1, padx=10, pady=8, sticky="e")
        self.hotkey_labels[action_key] = val_lbl

        btn = ctk.CTkButton(
            self.hotkey_frame, text="เปลี่ยน", width=50, height=24,
            command=lambda k=action_key: self.start_listening(k)
        )
        btn.grid(row=row, column=2, padx=10, pady=8)
        self.hotkey_buttons[action_key] = btn

        # --- Dropdown สำหรับแต่ละโหมด ---
        if action_key == "raw":
            frame = ctk.CTkFrame(self.hotkey_frame, fg_color="transparent")
            frame.grid(row=row + 1, column=0, columnspan=4, sticky="ew", padx=10, pady=8)
            ctk.CTkLabel(frame, text="โมเดล จัด Format ข้อความ:", font=ctk.CTkFont(size=12)).pack(side="left")
            self.raw_model_dropdown = ctk.CTkComboBox(
                frame, values=OPENROUTER_TEXT_MODELS, state="readonly",
                command=self._on_raw_model_change, width=150
            )
            self.raw_model_dropdown.set(self.raw_model)
            self.raw_model_dropdown.pack(side="right", fill="x", expand=True)

        elif action_key == "formal":
            frame = ctk.CTkFrame(self.hotkey_frame, fg_color="transparent")
            frame.grid(row=row + 1, column=0, columnspan=4, sticky="ew", padx=10, pady=8)
            ctk.CTkLabel(frame, text="โมเดล จัดการช่องว่าง:", font=ctk.CTkFont(size=12)).pack(side="left")
            self.formal_model_dropdown = ctk.CTkComboBox(
                frame, values=OPENROUTER_TEXT_MODELS, state="readonly",
                command=self._on_formal_model_change, width=150
            )
            self.formal_model_dropdown.set(self.formal_model)
            self.formal_model_dropdown.pack(side="right", fill="x", expand=True)

        elif action_key == "dingtalk_voice":
            frame = ctk.CTkFrame(self.hotkey_frame, fg_color="transparent")
            frame.grid(row=row + 1, column=0, columnspan=4, sticky="ew", padx=10, pady=8)
            ctk.CTkLabel(frame, text="เลือกโมเดล AI:", font=ctk.CTkFont(size=12)).pack(side="left")
            self.audio_model_dropdown = ctk.CTkComboBox(
                frame, values=OPENROUTER_AUDIO_MODELS, state="readonly",
                command=self._on_audio_model_change, width=150
            )
            self.audio_model_dropdown.set(self.audio_model)
            self.audio_model_dropdown.pack(side="right", fill="x", expand=True)

    # ==========================================
    # ฝั่งขวา: Terminal Log
    # ==========================================
    def _build_right_panel(self):
        self.right_frame = ctk.CTkFrame(self.main_container)
        self.right_frame.pack(side="right", fill="both", expand=True)

        term_header = ctk.CTkFrame(self.right_frame, fg_color="transparent")
        term_header.pack(fill="x", padx=15, pady=(15, 5))
        ctk.CTkLabel(
            term_header, text="TERMINAL LOG",
            font=ctk.CTkFont(size=12, weight="bold"), text_color="gray"
        ).pack(side="left")
        ctk.CTkButton(
            term_header, text="Clear Log", width=70, height=24,
            fg_color="#34495e", hover_color="#2c3e50",
            command=self.clear_terminal
        ).pack(side="right")

        self.log_console = ctk.CTkTextbox(
            self.right_frame,
            font=ctk.CTkFont(family="Consolas", size=12),
            fg_color="#1a1a1a"
        )
        self.log_console.pack(padx=15, pady=(0, 15), fill="both", expand=True)
        self.log_console.configure(state="disabled")

        # สีสำหรับแต่ละระดับ log
        self.log_console.tag_config("error",   foreground="#ff4d4d")
        self.log_console.tag_config("success", foreground="#2ecc71")
        self.log_console.tag_config("warning", foreground="#f1c40f")
        self.log_console.tag_config("info",    foreground="#3498db")
        self.log_console.tag_config("default", foreground="#ecf0f1")

        sys.stdout = TextboxRedirector(self, self.log_console)
        sys.stderr = TextboxRedirector(self, self.log_console)

    # ==========================================
    # UI Handlers
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
        self.register_all_hotkeys()

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

    def _update_button_reset(self):
        from aibot_dingver import CURRENT_VERSION
        self.update_btn.configure(state="normal")
        self.update_status_label.configure(
            text=f"เวอร์ชัน {CURRENT_VERSION}", text_color="#bdc3c7"
        )