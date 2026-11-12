"""
web_stream.py — lets horse_monitor.py show its window on the website (live, with outlines,
names and temperatures drawn on it). Only uses Python's standard library + OpenCV.

The script calls publish(view) with each picture; this file serves it as:
    http://<pi>:8000/stream.mjpg?key=...   live video (what the website Dashboard shows)
    http://<pi>:8000/snapshot.jpg?key=...  one still picture
    http://<pi>:8000/health                 {"ok": true} while frames are arriving (used by heartbeat.py)
    http://<pi>:8000/                       test page

Tailscale Funnel then gives port 8000 a public https:// address for the website.

Speed: publish() only hands the picture over (a copy, ~2 ms). Shrinking it for the website
(--stream-width, default 960 px) and JPEG compression happen in this file's own thread, so the
detection loop never waits for the stream.

Smooth video (camera speed instead of YOLO speed): call publish() from a camera thread with every
camera frame and pass overlay=draw, a function that draws the LATEST outlines / names / temperatures:
    stream.publish(frame, overlay=draw_latest)      # draw_latest(img, scale): img is already resized,
                                                    # multiply your coordinates by scale
The overlay runs in the stream's thread on the small picture, so it costs the detection loop nothing.
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import cv2


class MjpegServer:
    def __init__(self, port=8000, key="", fps=8.0, quality=75, host="0.0.0.0", width=960):
        self.key, self.min_gap, self.quality = key or "", 1.0 / max(fps, 0.5), int(quality)
        self.width = int(width or 0)                 # website picture width (0 = full size)
        self.jpeg, self.stamp, self.last_publish = None, 0.0, 0.0
        self.cond = threading.Condition()
        self._todo = None                            # (picture, overlay, time) waiting for the encoder
        self._todo_cond = threading.Condition()
        self.encoded = 0                             # pictures sent to the website (for fps checks)
        self.encode_ms = 0.0
        threading.Thread(target=self._encoder, daemon=True).start()
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):  # keep the terminal quiet
                pass

            def _allowed(self):
                if not server.key:
                    return True
                return parse_qs(urlparse(self.path).query).get("key", [""])[0] == server.key

            def _headers(self, code, ctype):
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

            def do_GET(self):
                path = urlparse(self.path).path
                if path == "/health":
                    self._headers(200, "application/json")
                    self.wfile.write(json.dumps({"ok": server.fresh()}).encode())
                elif path in ("/stream.mjpg", "/snapshot.jpg") and not self._allowed():
                    self._headers(403, "text/plain")
                    self.wfile.write(b"Wrong or missing ?key=")
                elif path == "/snapshot.jpg":
                    jpeg = server.wait_frame(5.0)
                    if jpeg is None:
                        self._headers(503, "text/plain")
                        self.wfile.write(b"No picture yet")
                        return
                    self._headers(200, "image/jpeg")
                    self.wfile.write(jpeg)
                elif path == "/stream.mjpg":
                    self._headers(200, "multipart/x-mixed-replace; boundary=frame")
                    last = 0.0
                    try:
                        while True:
                            jpeg = server.wait_frame(10.0, newer_than=last)
                            if jpeg is None:
                                continue
                            last = server.stamp
                            self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                             + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                    except (BrokenPipeError, ConnectionResetError):
                        pass  # viewer closed the page
                elif path == "/":
                    key = f"?key={server.key}" if server.key else ""
                    self._headers(200, "text/html; charset=utf-8")
                    self.wfile.write((
                        "<html><body style='background:#111;color:#fff;font-family:sans-serif;text-align:center'>"
                        "<h2>Horse Thermal Monitor - live from horse_monitor.py</h2>"
                        f"<img src='/stream.mjpg{key}' style='max-width:95%;border:3px solid #444'></body></html>"
                    ).encode())
                else:
                    self._headers(404, "text/plain")
                    self.wfile.write(b"Not found")

        self.httpd = ThreadingHTTPServer((host, port), Handler)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        print(f"Web stream: http://{host}:{port}/stream.mjpg" + ("?key=..." if self.key else "  (WARNING: no --stream-key)"))

    def publish(self, bgr, overlay=None):
        """Hand over the picture to show. Returns at once (~2 ms): resizing + JPEG happen in the stream's
        own thread. Pictures faster than --stream-fps are skipped. overlay(img, scale), if given, draws on
        the resized picture in the stream's thread (for smooth video from a camera thread)."""
        now = time.time()
        if bgr is None or now - self.last_publish < self.min_gap:
            return
        self.last_publish = now
        with self._todo_cond:
            self._todo = (bgr.copy(), overlay, now)   # copy: the caller may draw on its frame next
            self._todo_cond.notify()

    def _encoder(self):
        while True:
            with self._todo_cond:
                while self._todo is None:
                    self._todo_cond.wait()
                img, overlay, stamp = self._todo
                self._todo = None
            t = time.time()
            try:
                h, w = img.shape[:2]
                scale = 1.0
                if self.width and w > self.width:
                    scale = self.width / w
                    img = cv2.resize(img, (self.width, int(round(h * scale))), interpolation=cv2.INTER_AREA)
                if overlay is not None:
                    try:
                        overlay(img, scale)
                    except Exception as e:           # a drawing bug must never stop the video
                        print(f"Web stream: overlay error ({e})")
                ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, self.quality])
            except Exception as e:
                print(f"Web stream: can't encode picture ({e})")
                continue
            if not ok:
                continue
            self.encode_ms = (time.time() - t) * 1000
            with self.cond:
                self.jpeg, self.stamp = enc.tobytes(), stamp
                self.encoded += 1
                self.cond.notify_all()

    def wait_frame(self, timeout, newer_than=0.0):
        with self.cond:
            if self.stamp <= newer_than:
                self.cond.wait(timeout)
            return self.jpeg if self.stamp > newer_than else None

    def fresh(self):
        return self.jpeg is not None and time.time() - self.stamp < 10.0
