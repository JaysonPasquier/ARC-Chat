import asyncio
import ctypes
import ctypes.wintypes
import json
import os
import sys
import queue
import re
import tempfile
import threading
import tkinter as tk
from tkinter import font as tkfont
from difflib import SequenceMatcher

import mss.tools
from mss import MSS
from PIL import Image, ImageEnhance
from PIL import ImageChops

POLL_INTERVAL  = 2.0   # seconds between grabs
CODE_W_PCT     = 0.15  # code crop width, as a share of the window width...
CODE_W_MIN_H   = 0.30  # ...but at least this share of the window height (text size follows the height)
CODE_H_PCT     = 0.08
CODE_H_TIGHT_PCT = 0.03  # used instead when the crop reaches into the UI area, where the HUD's chat row sits just above the code
UI_ASPECT      = 16 / 9
JOUER_X1_PCT   = 0.70
JOUER_Y1_PCT   = 0.74
JOUER_X2_PCT   = 1.00
JOUER_Y2_PCT   = 0.97
YELLOW_MIN_PX  = 400
MIN_WINDOW_W   = 960   # below this the code is too small for OCR
MIN_WINDOW_H   = 540
JOUER_CONFIRM  = 3     # consecutive frames JOUER must be visible before triggering
CODE_SIMILARITY = 0.85 # codes more similar than this are treated as the same

STATE_SEARCHING     = "SEARCHING"
STATE_WAITING_JOUER = "WAITING_JOUER"
STATE_PAUSED        = "PAUSED"

TMP_PATH = os.path.join(tempfile.gettempdir(), f"arc_ocr_{os.getpid()}_{os.urandom(6).hex()}.png")

BG        = "#0e0e0e"
BG2       = "#1a1a1a"
BG3       = "#252525"
ACCENT    = "#f5c400"   # ARC Raiders yellow
TEXT      = "#e8e8e8"
TEXT_DIM  = "#666"
GREEN     = "#4caf50"
ORANGE    = "#ff9800"
RED       = "#f44336"


_user32 = ctypes.WinDLL("user32", use_last_error=True)
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
_user32.GetForegroundWindow.restype = ctypes.wintypes.HWND
_user32.IsIconic.argtypes = [ctypes.wintypes.HWND]
_user32.GetClientRect.argtypes = [ctypes.wintypes.HWND, ctypes.POINTER(ctypes.wintypes.RECT)]
_user32.ClientToScreen.argtypes = [ctypes.wintypes.HWND, ctypes.POINTER(ctypes.wintypes.POINT)]
_user32.GetWindowThreadProcessId.argtypes = [ctypes.wintypes.HWND, ctypes.POINTER(ctypes.wintypes.DWORD)]
_kernel32.OpenProcess.restype = ctypes.wintypes.HANDLE
_kernel32.QueryFullProcessImageNameW.argtypes = [
    ctypes.wintypes.HANDLE, ctypes.wintypes.DWORD, ctypes.wintypes.LPWSTR, ctypes.POINTER(ctypes.wintypes.DWORD),
]
_kernel32.CloseHandle.argtypes = [ctypes.wintypes.HANDLE]
_dpi_ready = False

PROBLEM_TEXT = {
    "not-focused": "Game not focused — paused",
    "minimized":   "Game window is minimized — paused",
    "too-small":   "Game window is too small to read — paused",
    "off-screen":  "Game window is partly off-screen — paused",
}


def _ensure_dpi_aware():
    global _dpi_ready
    if _dpi_ready:
        return
    _dpi_ready = True
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            _user32.SetProcessDPIAware()
        except Exception:
            pass


def _is_game_window(hwnd) -> bool:
    pid = ctypes.wintypes.DWORD()
    _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    handle = _kernel32.OpenProcess(0x1000, False, pid.value)
    if not handle:
        return False
    buf  = ctypes.create_unicode_buffer(520)
    size = ctypes.wintypes.DWORD(520)
    _kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size))
    _kernel32.CloseHandle(handle)
    return "PioneerGame" in buf.value


def find_game_window():
    _ensure_dpi_aware()
    hwnd = _user32.GetForegroundWindow()
    if not hwnd or not _is_game_window(hwnd):
        return None, "not-focused"
    if _user32.IsIconic(hwnd):
        return None, "minimized"
    rect = ctypes.wintypes.RECT()
    origin = ctypes.wintypes.POINT(0, 0)
    if not _user32.GetClientRect(hwnd, ctypes.byref(rect)) or not _user32.ClientToScreen(hwnd, ctypes.byref(origin)):
        return None, "not-focused"
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width < MIN_WINDOW_W or height < MIN_WINDOW_H:
        return None, "too-small"
    vx, vy = _user32.GetSystemMetrics(76), _user32.GetSystemMetrics(77)
    vw, vh = _user32.GetSystemMetrics(78), _user32.GetSystemMetrics(79)
    if origin.x < vx or origin.y < vy or origin.x + width > vx + vw or origin.y + height > vy + vh:
        return None, "off-screen"
    return (origin.x, origin.y, width, height), None


def capture_region(left: int, top: int, width: int, height: int) -> Image.Image:
    with MSS() as sct:
        raw = sct.grab({"left": left, "top": top, "width": width, "height": height})
        return Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")


def ui_area(width: int, height: int):
    w = min(width, int(height * UI_ASPECT))
    h = min(height, int(width / UI_ASPECT))
    return (width - w) // 2, (height - h) // 2, w, h


def crop_code_region(img: Image.Image) -> Image.Image:
    w, h = img.size
    crop_w = min(w, max(int(w * CODE_W_PCT), int(h * CODE_W_MIN_H)))
    left = w - crop_w
    ux, _, uw, _ = ui_area(w, h)
    crop_h = CODE_H_TIGHT_PCT if left < ux + uw else CODE_H_PCT
    return img.crop((left, h - int(h * crop_h), w, h))


def preprocess(img: Image.Image) -> Image.Image:
    img = img.resize((img.width * 4, img.height * 4), Image.LANCZOS)
    img = ImageEnhance.Contrast(img).enhance(3.0)
    img = ImageEnhance.Sharpness(img).enhance(2.0)
    return img


def is_jouer_visible(img: Image.Image) -> bool:
    ux, uy, uw, uh = ui_area(*img.size)
    x1, y1 = ux + int(uw * JOUER_X1_PCT), uy + int(uh * JOUER_Y1_PCT)
    x2, y2 = ux + int(uw * JOUER_X2_PCT), uy + int(uh * JOUER_Y2_PCT)
    region = img.crop((x1, y1, x2, y2)).convert("RGB")
    r, g, b = region.split()
    mask = ImageChops.multiply(
        ImageChops.multiply(r.point(lambda v: 255 if v > 200 else 0), g.point(lambda v: 255 if 140 < v < 210 else 0)),
        b.point(lambda v: 255 if v < 60 else 0),
    )
    return mask.histogram()[255] > YELLOW_MIN_PX


def same_code(a: str, b: str) -> bool:
    return SequenceMatcher(None, a, b).ratio() >= CODE_SIMILARITY


def parse_code(ocr_text: str):
    text = ocr_text.strip()
    text = re.sub(r'^#(\d{3,})', r'p4\1', text)
    text = re.sub(r'^9', 'p', text)
    m = re.search(r'p[a-z0-9]{4}(?:-[a-z0-9]{5}){0,2}', text, re.IGNORECASE)
    return m.group(0).lower() if m else None


async def ocr_pil(pil_img: Image.Image) -> str:
    import winsdk.windows.media.ocr as wocr
    import winsdk.windows.graphics.imaging as wgi
    import winsdk.windows.storage as wst

    pil_img.save(TMP_PATH)
    engine = wocr.OcrEngine.try_create_from_user_profile_languages()
    f      = await wst.StorageFile.get_file_from_path_async(TMP_PATH)
    stream = await f.open_async(wst.FileAccessMode.READ)
    dec    = await wgi.BitmapDecoder.create_async(stream)
    bmp    = await dec.get_software_bitmap_async()
    result = await engine.recognize_async(bmp)
    stream.close()
    try:
        os.remove(TMP_PATH)
    except OSError:
        pass
    return result.text



async def watcher_loop(msg_queue: queue.Queue):
    state        = STATE_SEARCHING
    last_code    = None
    jouer_streak = 0   # consecutive frames where JOUER was visible
    paused       = False
    last_problem = None

    msg_queue.put(("state", state))
    msg_queue.put(("log", "Watcher started — scanning for code…"))

    while True:
        try:
            rect, problem = find_game_window()
            if rect is None:
                if not paused or problem != last_problem:
                    paused = True
                    last_problem = problem
                    msg_queue.put(("state", STATE_PAUSED))
                    msg_queue.put(("log", PROBLEM_TEXT[problem]))
                await asyncio.sleep(POLL_INTERVAL)
                continue
            if paused:
                paused = False
                last_problem = None
                msg_queue.put(("state", state))
                msg_queue.put(("log", f"Game window found ({rect[2]}x{rect[3]}) — resumed"))

            screen = capture_region(*rect)

            if state == STATE_SEARCHING:
                jouer_streak = 0
                crop     = crop_code_region(screen)
                enhanced = preprocess(crop)
                raw_text = await ocr_pil(enhanced)
                code     = parse_code(raw_text)

                if code:
                    if last_code and same_code(code, last_code):
                        msg_queue.put(("log", f"Skip — same code as last match: {last_code}"))
                    else:
                        last_code = code
                        msg_queue.put(("code", code))
                        msg_queue.put(("log", f"NEW CODE: {code}"))
                        state = STATE_WAITING_JOUER
                        msg_queue.put(("state", state))
                        msg_queue.put(("log", "Watching for JOUER button…"))
                else:
                    msg_queue.put(("log", f"Scanning… (raw: {repr(raw_text.strip())})"))

            elif state == STATE_WAITING_JOUER:
                if is_jouer_visible(screen):
                    jouer_streak += 1
                    msg_queue.put(("log", f"JOUER visible ({jouer_streak}/{JOUER_CONFIRM})…"))
                    if jouer_streak >= JOUER_CONFIRM:
                        jouer_streak = 0
                        msg_queue.put(("log", "JOUER confirmed — back in lobby, scanning for new code…"))
                        msg_queue.put(("lobby", last_code))
                        state = STATE_SEARCHING
                        msg_queue.put(("state", state))
                else:
                    if jouer_streak > 0:
                        msg_queue.put(("log", f"JOUER lost (was {jouer_streak} frames) — false positive, resetting"))
                    jouer_streak = 0
                    msg_queue.put(("log", "In match…"))

        except Exception as exc:
            msg_queue.put(("log", f"Error: {exc}"))

        await asyncio.sleep(POLL_INTERVAL)


def run_watcher(msg_queue: queue.Queue):
    asyncio.run(watcher_loop(msg_queue))



class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ARC Raiders Chat")
        self.configure(bg=BG)
        self.resizable(False, False)
        self.attributes("-topmost", True)
        self.geometry("380x420")

        self._queue    = queue.Queue()
        self._code     = tk.StringVar(value="—")
        self._state    = tk.StringVar(value=STATE_SEARCHING)
        self._ontop    = tk.BooleanVar(value=True)
        self._log_lines = []

        self._build_ui()
        self._start_watcher()
        self._poll()


    def _build_ui(self):
        pad = dict(padx=14, pady=6)

        hdr = tk.Frame(self, bg=BG2, height=44)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)

        title_font = tkfont.Font(family="Segoe UI", size=12, weight="bold")
        tk.Label(hdr, text="⬡  ARC RAIDERS CHAT", bg=BG2, fg=ACCENT,
                 font=title_font).pack(side="left", padx=14, pady=10)

        cb = tk.Checkbutton(hdr, text="On top", variable=self._ontop,
                            bg=BG2, fg=TEXT_DIM, selectcolor=BG3,
                            activebackground=BG2, activeforeground=TEXT,
                            command=self._toggle_topmost)
        cb.pack(side="right", padx=10)

        pill_frame = tk.Frame(self, bg=BG)
        pill_frame.pack(fill="x", **pad)

        self._dot = tk.Label(pill_frame, text="●", fg=ORANGE, bg=BG,
                             font=("Segoe UI", 10))
        self._dot.pack(side="left")

        self._state_lbl = tk.Label(pill_frame, textvariable=self._state,
                                   bg=BG, fg=TEXT_DIM,
                                   font=("Segoe UI", 9))
        self._state_lbl.pack(side="left", padx=6)

        code_frame = tk.Frame(self, bg=BG2, bd=0, relief="flat")
        code_frame.pack(fill="x", padx=14, pady=(2, 8))

        tk.Label(code_frame, text="MATCH CODE", bg=BG2, fg=TEXT_DIM,
                 font=("Segoe UI", 8)).pack(anchor="w", padx=12, pady=(8, 0))

        code_inner = tk.Frame(code_frame, bg=BG2)
        code_inner.pack(fill="x", padx=12, pady=(0, 10))

        code_font = tkfont.Font(family="Consolas", size=18, weight="bold")
        self._code_lbl = tk.Label(code_inner, textvariable=self._code,
                                  bg=BG2, fg=ACCENT, font=code_font,
                                  anchor="w")
        self._code_lbl.pack(side="left", fill="x", expand=True)

        copy_btn = tk.Button(code_inner, text="Copy", bg=BG3, fg=TEXT,
                             relief="flat", padx=10, pady=4,
                             activebackground=ACCENT, activeforeground=BG,
                             cursor="hand2", command=self._copy_code)
        copy_btn.pack(side="right")

        tk.Label(self, text="LOG", bg=BG, fg=TEXT_DIM,
                 font=("Segoe UI", 8)).pack(anchor="w", padx=14)

        log_frame = tk.Frame(self, bg=BG3)
        log_frame.pack(fill="both", expand=True, padx=14, pady=(2, 14))

        scrollbar = tk.Scrollbar(log_frame, bg=BG3, troughcolor=BG2)
        scrollbar.pack(side="right", fill="y")

        self._log = tk.Text(log_frame, bg=BG3, fg=TEXT_DIM,
                            font=("Consolas", 8), relief="flat",
                            wrap="word", state="disabled",
                            yscrollcommand=scrollbar.set,
                            insertbackground=TEXT)
        self._log.pack(fill="both", expand=True, padx=6, pady=6)
        scrollbar.config(command=self._log.yview)

        self._log.tag_config("new",   foreground=GREEN)
        self._log.tag_config("warn",  foreground=ORANGE)
        self._log.tag_config("error", foreground=RED)
        self._log.tag_config("dim",   foreground=TEXT_DIM)


    def _toggle_topmost(self):
        self.attributes("-topmost", self._ontop.get())

    def _copy_code(self):
        code = self._code.get()
        if code != "—":
            self.clipboard_clear()
            self.clipboard_append(code)

    def _append_log(self, msg: str):
        tag = "dim"
        if "NEW CODE" in msg or "detected" in msg.lower():
            tag = "new"
        elif "Error" in msg or "error" in msg:
            tag = "error"
        elif "Skip" in msg or "same" in msg.lower():
            tag = "warn"

        self._log.config(state="normal")
        self._log.insert("end", f"{msg}\n", tag)
        self._log.see("end")
        lines = int(self._log.index("end-1c").split(".")[0])
        if lines > 200:
            self._log.delete("1.0", f"{lines - 200}.0")
        self._log.config(state="disabled")

    def _set_state(self, state: str):
        self._state.set(state)
        if state == STATE_SEARCHING:
            self._dot.config(fg=ORANGE)
        elif state == STATE_WAITING_JOUER:
            self._dot.config(fg=GREEN)
        else:
            self._dot.config(fg=TEXT_DIM)


    def _poll(self):
        try:
            while True:
                kind, val = self._queue.get_nowait()
                if kind == "log":
                    self._append_log(val)
                elif kind == "code":
                    self._code.set(val)
                    self._code_lbl.config(fg=ACCENT)
                elif kind == "state":
                    self._set_state(val)
        except queue.Empty:
            pass
        self.after(300, self._poll)


    def _start_watcher(self):
        t = threading.Thread(target=run_watcher, args=(self._queue,),
                             daemon=True)
        t.start()


class StdoutSink:
    def put(self, item):
        kind, value = item
        print(json.dumps({"type": kind, "value": value}), flush=True)


def selftest() -> int:
    problems = []
    if parse_code("p4895-pnthc-7srtk") != "p4895-pnthc-7srtk":
        problems.append("code parsing")
    img = Image.new("RGB", (400, 200), (246, 194, 27))
    if not is_jouer_visible(Image.new("RGB", (1920, 1080), (246, 194, 27))):
        problems.append("JOUER colour detection")
    if is_jouer_visible(Image.new("RGB", (1920, 1080), (10, 10, 10))):
        problems.append("JOUER false positive")
    try:
        asyncio.run(ocr_pil(preprocess(img)))
    except Exception as exc:
        problems.append(f"Windows OCR: {exc}")
    print(json.dumps({"type": "selftest", "ok": not problems, "problems": problems}), flush=True)
    return 1 if problems else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    elif "--headless" in sys.argv:
        asyncio.run(watcher_loop(StdoutSink()))
    else:
        App().mainloop()
