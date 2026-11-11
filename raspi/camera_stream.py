"""
Horse Thermal Monitor — Raspberry Pi live camera stream
=======================================================
Streams the Pi's camera as MJPEG so the website's Dashboard can show it live.

    http://<pi-address>:8000/              → simple test page
    http://<pi-address>:8000/stream.mjpg   → live video (what the Dashboard uses)
    http://<pi-address>:8000/snapshot.jpg  → one still picture

Works with:
  * Raspberry Pi Camera Module (uses picamera2)
  * USB webcam or USB thermal camera that shows up as a webcam (uses OpenCV)
  * --test   : a moving test picture, to try everything without a camera

Install on Raspberry Pi OS (Bookworm):
    sudo apt update
    sudo apt install -y python3-flask python3-opencv python3-picamera2

Run:
    python3 camera_stream.py --key MySecretKey123
    python3 camera_stream.py --usb --key MySecretKey123      # force USB camera
    python3 camera_stream.py --test --key MySecretKey123     # no camera needed

The --key protects the stream: the address must end with ?key=MySecretKey123.
Then make it reachable from the website with Tailscale Funnel (see RASPI-CAMERA-GUIDE.md).
"""
import argparse
import threading
import time
from datetime import datetime

import cv2
from flask import Flask, Response, abort, request

app = Flask(__name__)
STREAM_KEY = ""


class FrameSource:
    """Captures frames in a background thread and keeps the newest JPEG for all viewers."""

    def __init__(self, width: int, height: int, fps: int, quality: int, mode: str, device: int):
        self.width, self.height, self.fps, self.quality = width, height, fps, quality
        self.mode, self.device = mode, device
        self.jpeg: bytes | None = None
        self.condition = threading.Condition()
        self.picam = None
        self.capture = None
        self._open_camera()
        threading.Thread(target=self._run, daemon=True).start()

    # ---------- camera setup ----------
    def _open_camera(self):
        if self.mode == "test":
            print("Using TEST PATTERN (no camera).")
            return
        if self.mode in ("auto", "picamera"):
            try:
                from picamera2 import Picamera2

                self.picam = Picamera2()
                config = self.picam.create_video_configuration(
                    main={"size": (self.width, self.height), "format": "RGB888"}
                )
                self.picam.configure(config)
                self.picam.start()
                print("Using Raspberry Pi Camera Module (picamera2).")
                return
            except Exception as error:  # no Pi camera, or picamera2 not installed
                if self.mode == "picamera":
                    raise SystemExit(f"Pi camera not available: {error}")
                print(f"Pi camera not available ({error}); trying USB camera…")
        self.capture = cv2.VideoCapture(self.device)
        self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        if not self.capture.isOpened():
            raise SystemExit(f"No camera found at /dev/video{self.device}. Try --test to check the setup.")
        print(f"Using USB camera /dev/video{self.device} (OpenCV).")

    # ---------- frame grabbing ----------
    def _grab(self):
        if self.picam is not None:
            return self.picam.capture_array()  # already in OpenCV (BGR) channel order
        if self.capture is not None:
            ok, frame = self.capture.read()
            return frame if ok else None
        return self._test_pattern()

    def _test_pattern(self):
        import numpy as np

        t = time.time()
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        x = int((t * 120) % self.width)
        frame[:, :, 1] = 40
        cv2.rectangle(frame, (x - 60, 0), (x + 60, self.height), (0, 140, 255), -1)
        cv2.putText(frame, "TEST PATTERN - Horse Thermal Monitor", (20, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        cv2.putText(frame, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), (20, self.height - 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        return frame

    def _run(self):
        delay = 1.0 / self.fps
        while True:
            started = time.time()
            frame = self._grab()
            if frame is not None:
                cv2.putText(frame, datetime.now().strftime("%H:%M:%S"), (self.width - 140, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, self.quality])
                if ok:
                    with self.condition:
                        self.jpeg = encoded.tobytes()
                        self.condition.notify_all()
            else:
                time.sleep(0.5)  # camera hiccup — wait and try again
            time.sleep(max(0.0, delay - (time.time() - started)))

    def wait_for_frame(self, timeout: float = 5.0) -> bytes | None:
        with self.condition:
            self.condition.wait(timeout)
            return self.jpeg


source: FrameSource | None = None


def check_key():
    if STREAM_KEY and request.args.get("key") != STREAM_KEY:
        abort(403, "Wrong or missing ?key=")


@app.after_request
def add_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@app.route("/")
def index():
    key_part = f"?key={STREAM_KEY}" if STREAM_KEY else ""
    return (
        "<html><body style='background:#111;color:#fff;font-family:sans-serif;text-align:center'>"
        "<h2>🐎 Horse Thermal Monitor — Pi camera</h2>"
        f"<img src='/stream.mjpg{key_part}' style='max-width:95%;border:3px solid #444'>"
        "<p>If you can see the video, the camera works. Use the Tailscale Funnel https address + "
        f"<code>/stream.mjpg{key_part}</code> in the website Settings.</p></body></html>"
    )


@app.route("/stream.mjpg")
def stream():
    check_key()

    def generate():
        while True:
            jpeg = source.wait_for_frame()
            if jpeg is None:
                continue
            yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                   + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")

    return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/snapshot.jpg")
def snapshot():
    check_key()
    jpeg = source.wait_for_frame()
    if jpeg is None:
        abort(503, "Camera not ready yet")
    return Response(jpeg, mimetype="image/jpeg")


@app.route("/health")
def health():
    return {"ok": source is not None and source.jpeg is not None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Stream the Raspberry Pi camera for the Horse Thermal Monitor website")
    parser.add_argument("--key", default="", help="Secret key required in the stream address (?key=...)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--fps", type=int, default=15)
    parser.add_argument("--quality", type=int, default=75, help="JPEG quality 1-100 (lower = faster on slow internet)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--usb", action="store_true", help="Use a USB/thermal webcam instead of the Pi camera")
    group.add_argument("--picamera", action="store_true", help="Only use the Pi Camera Module")
    group.add_argument("--test", action="store_true", help="Show a moving test picture (no camera needed)")
    parser.add_argument("--device", type=int, default=0, help="USB camera number (/dev/videoN)")
    args = parser.parse_args()

    STREAM_KEY = args.key
    mode = "test" if args.test else "usb" if args.usb else "picamera" if args.picamera else "auto"
    source = FrameSource(args.width, args.height, args.fps, args.quality, mode, args.device)

    if not STREAM_KEY:
        print("WARNING: no --key given. Anyone with the address can watch the camera.")
    print(f"Camera stream running on http://0.0.0.0:{args.port}/stream.mjpg"
          + (f"?key={STREAM_KEY}" if STREAM_KEY else ""))
    app.run(host="0.0.0.0", port=args.port, threaded=True)
