import sys
import customtkinter as ctk


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
        elif any(kw in string for kw in ["📌", "🧹", "🧠", "🌐"]):
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

    def isatty(self):
        """Uvicorn/logging call sys.stdout.isatty(); real TTY is gone once we redirect."""
        return False


class AppUI:
    """
    Mixin สำหรับ UI — ใช้ผ่าน multiple inheritance กับ AITranscriberApp
    """

    def setup_window(self, resource_path_fn):
        import os

        self.title("AI Transcriber Pro")
        self.geometry("900x550")
        self.resizable(False, False)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        if os.path.exists(resource_path_fn("app_icon.ico")):
            self.iconbitmap(resource_path_fn("app_icon.ico"))

        self.protocol("WM_DELETE_WINDOW", self.quit_app)

    def setup_ui(self):
        self.main_container = ctk.CTkFrame(self, fg_color="transparent")
        self.main_container.pack(fill="both", expand=True, padx=15, pady=15)

        self._build_left_panel()
        self._build_right_panel()

    def _build_left_panel(self):
        self.left_frame = ctk.CTkFrame(self.main_container, width=380)
        self.left_frame.pack(side="left", fill="both", padx=(0, 10))
        self.left_frame.pack_propagate(False)

        self._build_top_bar()
        self._build_status_bar()
        self._build_models_panel()

    def _build_top_bar(self):
        from aibot_dingver import CURRENT_VERSION

        self.top_bar = ctk.CTkFrame(self.left_frame, fg_color="transparent")
        self.top_bar.pack(fill="x", pady=(20, 5), padx=20)

        self.header_frame = ctk.CTkFrame(self.top_bar, fg_color="transparent")
        self.header_frame.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(
            self.header_frame,
            text="AI TEXT TOOLS",
            font=ctk.CTkFont(size=22, weight="bold"),
        ).pack(anchor="w")

        self.update_status_label = ctk.CTkLabel(
            self.header_frame,
            text=f"เวอร์ชัน {CURRENT_VERSION}",
            font=ctk.CTkFont(size=12),
            text_color="#bdc3c7",
        )
        self.update_status_label.pack(anchor="w")

        self.fold_btn = ctk.CTkButton(
            self.top_bar,
            text="◀ พับ",
            width=50,
            height=28,
            fg_color="#34495e",
            hover_color="#2c3e50",
            font=ctk.CTkFont(weight="bold"),
            command=self.toggle_terminal,
        )
        self.fold_btn.pack(side="right")

        self.pin_btn = ctk.CTkButton(
            self.top_bar,
            text="📌",
            width=30,
            height=28,
            fg_color="#34495e",
            hover_color="#2c3e50",
            font=ctk.CTkFont(size=14),
            command=self.toggle_topmost,
        )
        self.pin_btn.pack(side="right", padx=(5, 5))

        self.update_btn = ctk.CTkButton(
            self.top_bar,
            text="🔄 อัปเดต",
            width=65,
            height=28,
            fg_color="#2980b9",
            hover_color="#3498db",
            font=ctk.CTkFont(size=12, weight="bold"),
            command=self.check_for_updates,
        )
        self.update_btn.pack(side="right")

    def _build_status_bar(self):
        self.status_container = ctk.CTkFrame(self.left_frame, height=60, corner_radius=10)
        self.status_container.pack(fill="x", padx=30, pady=10)
        self.status_label = ctk.CTkLabel(
            self.status_container,
            text="SYSTEM ACTIVE",
            font=ctk.CTkFont(size=16, weight="bold"),
            text_color="#2ecc71",
        )
        self.status_label.place(relx=0.5, rely=0.5, anchor="center")

        self.switch_var = ctk.BooleanVar(value=True)
        self.toggle_switch = ctk.CTkSwitch(
            self.left_frame,
            text="เปิดใช้งานระบบ AI",
            variable=self.switch_var,
            command=self.on_status_change,
            font=ctk.CTkFont(size=13),
        )
        self.toggle_switch.pack(pady=10)

    def _build_models_panel(self):
        from aibot_dingver import LOCAL_API_HOST, LOCAL_API_PORT, OPENROUTER_AUDIO_MODELS, OPENROUTER_TEXT_MODELS

        frame = ctk.CTkFrame(self.left_frame, fg_color="transparent")
        frame.pack(fill="x", padx=20, pady=(5, 10))

        ctk.CTkLabel(
            frame,
            text="DingTalk extension ส่งเสียงไปที่",
            font=ctk.CTkFont(size=12),
            text_color="#95a5a6",
        ).pack(anchor="w")
        ctk.CTkLabel(
            frame,
            text=f"http://{LOCAL_API_HOST}:{LOCAL_API_PORT}/api/transcribe",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color="#1abc9c",
        ).pack(anchor="w", pady=(0, 12))

        ctk.CTkLabel(frame, text="โมเดลถอดเสียง (OpenRouter):", font=ctk.CTkFont(size=12)).pack(anchor="w")
        self.audio_model_dropdown = ctk.CTkComboBox(
            frame,
            values=OPENROUTER_AUDIO_MODELS,
            state="readonly",
            command=self._on_audio_model_change,
            width=320,
        )
        self.audio_model_dropdown.set(self.audio_model)
        self.audio_model_dropdown.pack(fill="x", pady=(4, 14))

        ctk.CTkLabel(frame, text="โมเดล Formal (หลังถอดเสียง):", font=ctk.CTkFont(size=12)).pack(anchor="w")
        self.formal_model_dropdown = ctk.CTkComboBox(
            frame,
            values=OPENROUTER_TEXT_MODELS,
            state="readonly",
            command=self._on_formal_model_change,
            width=320,
        )
        self.formal_model_dropdown.set(self.formal_model)
        self.formal_model_dropdown.pack(fill="x", pady=(4, 0))

    def _build_right_panel(self):
        self.right_frame = ctk.CTkFrame(self.main_container)
        self.right_frame.pack(side="right", fill="both", expand=True)

        term_header = ctk.CTkFrame(self.right_frame, fg_color="transparent")
        term_header.pack(fill="x", padx=15, pady=(15, 5))
        ctk.CTkLabel(
            term_header,
            text="TERMINAL LOG",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color="gray",
        ).pack(side="left")
        ctk.CTkButton(
            term_header,
            text="Clear Log",
            width=70,
            height=24,
            fg_color="#34495e",
            hover_color="#2c3e50",
            command=self.clear_terminal,
        ).pack(side="right")

        self.log_console = ctk.CTkTextbox(
            self.right_frame,
            font=ctk.CTkFont(family="Consolas", size=12),
            fg_color="#1a1a1a",
        )
        self.log_console.pack(padx=15, pady=(0, 15), fill="both", expand=True)
        self.log_console.configure(state="disabled")

        self.log_console.tag_config("error", foreground="#ff4d4d")
        self.log_console.tag_config("success", foreground="#2ecc71")
        self.log_console.tag_config("warning", foreground="#f1c40f")
        self.log_console.tag_config("info", foreground="#3498db")
        self.log_console.tag_config("default", foreground="#ecf0f1")

        sys.stdout = TextboxRedirector(self, self.log_console)
        sys.stderr = TextboxRedirector(self, self.log_console)

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

    def _update_button_reset(self):
        from aibot_dingver import CURRENT_VERSION

        self.update_btn.configure(state="normal")
        self.update_status_label.configure(
            text=f"เวอร์ชัน {CURRENT_VERSION}", text_color="#bdc3c7"
        )
