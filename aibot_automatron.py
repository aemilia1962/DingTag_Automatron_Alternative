import glob
import os
import threading
import time

from aibot_dingver import AITranscriberApp


class AutomatronBridgeApp(AITranscriberApp):
    """
    Bridge layer for Chrome Extension -> Python app.
    Extension creates trigger files in Downloads, this app catches them
    and runs DingTalk voice transcription flow automatically.
    """

    def __init__(self):
        super().__init__()
        self._bridge_running = True
        self._bridge_lock = threading.Lock()
        self._bridge_seen = set()
        self._downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
        self._trigger_patterns = [
            "dingtalk_format_trigger*.txt",
            "dingtalk_bridge_trigger*.txt",
        ]

        threading.Thread(target=self._bridge_trigger_watcher, daemon=True).start()
        print("[🔌] Automatron Bridge พร้อมรับ trigger จาก Extension แล้ว")

    def _collect_trigger_files(self):
        paths = []
        for pattern in self._trigger_patterns:
            paths.extend(glob.glob(os.path.join(self._downloads_dir, pattern)))
        # Sort by mtime to process older triggers first.
        paths.sort(key=lambda p: os.path.getmtime(p) if os.path.exists(p) else 0)
        return paths

    def _bridge_trigger_watcher(self):
        while self._bridge_running:
            try:
                trigger_files = self._collect_trigger_files()
                if not trigger_files:
                    time.sleep(0.25)
                    continue

                for file_path in trigger_files:
                    if file_path in self._bridge_seen:
                        continue

                    self._bridge_seen.add(file_path)
                    if os.path.exists(file_path):
                        try:
                            os.remove(file_path)
                        except Exception:
                            pass

                    if self._bridge_lock.acquire(blocking=False):
                        try:
                            print(f"[📥] รับ trigger แล้ว: {os.path.basename(file_path)}")
                            # Run exactly the flow user asked for after Delete Spaces.
                            self.dingtalk_transcribe_and_paste()
                        finally:
                            self._bridge_lock.release()
                    else:
                        print("[⏳] ข้าม trigger เพราะกำลังประมวลผลเสียงอยู่แล้ว")
            except Exception as e:
                print(f"[❌] Bridge watcher error: {e}")
            finally:
                time.sleep(0.2)

    def quit_app(self):
        self._bridge_running = False
        super().quit_app()


if __name__ == "__main__":
    app = AutomatronBridgeApp()
    app.mainloop()
