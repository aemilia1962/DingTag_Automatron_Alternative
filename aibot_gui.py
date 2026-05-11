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
        self.geometry("900x620")
        self.resizable(False, False)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        _gui_dir = os.path.dirname(os.path.abspath(__file__))
        for candidate in (
            resource_path_fn("Automatron.ico"),
            os.path.join(_gui_dir, "Automatron.ico"),
            resource_path_fn("app_icon.ico"),
            os.path.join(_gui_dir, "app_icon.ico"),
        ):
            if os.path.isfile(candidate):
                try:
                    self.iconbitmap(candidate)
                except Exception:
                    pass
                else:
                    break

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

    def _build_task_tracker_panel(self):
        """แผงสถิติด้านขวา — ใช้ร่วมกับ right_tracker_wrap (สัดส่วนความสูงจัดที่ grid แม่)"""
        box = ctk.CTkFrame(self.right_tracker_wrap, corner_radius=10, fg_color=("#2b2b2b", "#1e272e"))
        box.pack(fill="both", expand=True)

        ctk.CTkLabel(
            box,
            text="TIME / TASK TRACKER",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color="#95a5a6",
        ).pack(anchor="w", padx=10, pady=(8, 4))

        self.tracker_elapsed_label = ctk.CTkLabel(
            box,
            text="เซสชันนี้: —",
            font=ctk.CTkFont(size=11),
            anchor="w",
        )
        self.tracker_elapsed_label.pack(fill="x", padx=10, pady=(0, 1))

        self.tracker_files_label = ctk.CTkLabel(
            box,
            text="ถอดเสียงสำเร็จ: 0 ไฟล์",
            font=ctk.CTkFont(size=11),
            anchor="w",
        )
        self.tracker_files_label.pack(fill="x", padx=10, pady=(0, 1))

        self.tracker_formal_label = ctk.CTkLabel(
            box,
            text="Formalize สำเร็จ: 0 ครั้ง",
            font=ctk.CTkFont(size=11),
            anchor="w",
        )
        self.tracker_formal_label.pack(fill="x", padx=10, pady=(0, 1))

        self.tracker_proc_label = ctk.CTkLabel(
            box,
            text="เวลาประมวลผล AI รวม: —",
            font=ctk.CTkFont(size=10),
            text_color="#bdc3c7",
            anchor="w",
        )
        self.tracker_proc_label.pack(fill="x", padx=10, pady=(0, 8))

    def _build_models_panel(self):
        from aibot_dingver import LOCAL_API_HOST, LOCAL_API_PORT

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

        ctk.CTkLabel(
            frame,
            text=f"โมเดลถอดเสียง: {self.audio_model}",
            font=ctk.CTkFont(size=12),
            text_color="#ecf0f1",
        ).pack(anchor="w", pady=(0, 6))

        ctk.CTkLabel(
            frame,
            text=f"โมเดลจัดข้อความ: {self.formal_model}",
            font=ctk.CTkFont(size=12),
            text_color="#ecf0f1",
        ).pack(anchor="w", pady=(0, 0))

    def _build_right_panel(self):
        self.right_frame = ctk.CTkFrame(self.main_container)
        self.right_frame.pack(side="right", fill="both", expand=True)

        # แบ่งแนวตั้ง 1 : 3 — Tracker (บน) : Terminal (ล่าง)
        self.right_frame.grid_rowconfigure(0, weight=1)
        self.right_frame.grid_rowconfigure(1, weight=3)
        self.right_frame.grid_columnconfigure(0, weight=1)

        self.right_tracker_wrap = ctk.CTkFrame(self.right_frame, fg_color="transparent")
        self.right_tracker_wrap.grid(row=0, column=0, sticky="nsew", padx=15, pady=(15, 6))

        self.right_terminal_wrap = ctk.CTkFrame(self.right_frame, fg_color="transparent")
        self.right_terminal_wrap.grid(row=1, column=0, sticky="nsew", padx=15, pady=(0, 15))

        self._build_task_tracker_panel()

        term_header = ctk.CTkFrame(self.right_terminal_wrap, fg_color="transparent")
        term_header.pack(fill="x", pady=(0, 5))
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
            self.right_terminal_wrap,
            font=ctk.CTkFont(family="Consolas", size=12),
            fg_color="#1a1a1a",
        )
        self.log_console.pack(fill="both", expand=True)
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
            self.geometry("420x620")
            self.fold_btn.configure(text="▶ กาง")
        else:
            self.right_frame.pack(side="right", fill="both", expand=True)
            self.geometry("900x620")
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
