"""
Horse Thermal Monitor — Raspberry Pi heartbeat ("I'm connected")
================================================================
Every 30 seconds the Pi tells the website it is alive, plus a short health report:
CPU temperature, uptime, local IP, whether the camera / thermal sensor are found,
and whether the detection program (horse_monitor.py) is running.
The website shows "Raspberry Pi: Online" in the header and details in Settings.

Needs only the PUBLIC Supabase key + this Pi's device_key (never the service_role key).

Run by itself (recommended, as a service that starts on boot):
    python3 heartbeat.py --url https://YOUR-PROJECT.supabase.co --key sb_publishable_... --device-key ...

Or use it INSIDE horse_monitor.py so it reports the real sensor state:
    from heartbeat import Heartbeat
    hb = Heartbeat(SUPABASE_URL, SUPABASE_KEY, DEVICE_KEY)   # starts a background thread
    hb.update(camera=True, thermal=True, dht=True, air_temp=27.4, humidity=81)  # whenever you have new values
Values given with update() replace the automatic checks.

Settings can also come from environment variables: SUPABASE_URL, SUPABASE_KEY, DEVICE_KEY.
Only uses the Python standard library (no pip install needed).
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

APP_NAME = "heartbeat.py v1"


# ---------------------------------------------------------------- system checks
def _read(path: str) -> str | None:
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def cpu_temperature() -> float | None:
    raw = _read("/sys/class/thermal/thermal_zone0/temp")
    return round(int(raw) / 1000, 1) if raw and raw.isdigit() else None


def uptime_seconds() -> int | None:
    raw = _read("/proc/uptime")
    return int(float(raw.split()[0])) if raw else None


def local_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))  # no data is sent; just picks the active network
            return s.getsockname()[0]
    except OSError:
        return None


def camera_ok(stream_health_url: str | None) -> bool | None:
    """True if the live stream program answers, else checks that the Pi sees a camera."""
    if stream_health_url:
        try:
            with urllib.request.urlopen(stream_health_url, timeout=3) as r:
                return bool(json.load(r).get("ok"))
        except Exception:
            pass  # stream not running → fall back to "is a camera connected?"
    if shutil.which("rpicam-hello"):
        try:
            out = subprocess.run(["rpicam-hello", "--list-cameras"], capture_output=True, text=True, timeout=8)
            text = (out.stdout + out.stderr).lower()
            return "available cameras" in text and "no cameras available" not in text
        except Exception:
            return None
    return any(name.startswith("video") for name in os.listdir("/dev")) if os.path.isdir("/dev") else None


def i2c_device_present(address: int, bus: int = 1) -> bool | None:
    """Thermal sensor check: is something answering at the MLX90640 I2C address (0x33)?"""
    if not shutil.which("i2cdetect"):
        return None
    try:
        out = subprocess.run(["i2cdetect", "-y", str(bus)], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return None
    # The table has rows "00:", "10:", … and 16 columns; 0x33 is row "30:", column 3.
    row_label = f"{address & 0xF0:02x}:"
    for line in out.splitlines():
        cells = line.split()
        if cells and cells[0] == row_label:
            cell = line[4 + 3 * (address & 0x0F): 4 + 3 * (address & 0x0F) + 2].strip().lower()
            return cell in (f"{address:02x}", "uu")  # "uu" = in use by a driver/program
    return False


def program_running(name: str) -> bool:
    try:
        return subprocess.run(["pgrep", "-f", name], capture_output=True).returncode == 0
    except FileNotFoundError:
        return False


# ---------------------------------------------------------------- sending
def send_heartbeat(supabase_url: str, supabase_key: str, device_key: str, status: dict) -> dict:
    request = urllib.request.Request(
        f"{supabase_url.rstrip('/')}/rest/v1/rpc/device_heartbeat",
        data=json.dumps({"p_device_key": device_key, "p_status": status}).encode(),
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


class Heartbeat:
    """Sends a heartbeat every `interval` seconds in a background thread."""

    def __init__(self, supabase_url, supabase_key, device_key, interval=30,
                 stream_health_url="http://127.0.0.1:8000/health", thermal_address=0x33,
                 monitor_name="horse_monitor.py", start=True, verbose=True):
        self.url, self.key, self.device_key = supabase_url, supabase_key, device_key
        self.interval, self.stream_health_url = interval, stream_health_url
        self.thermal_address, self.monitor_name, self.verbose = thermal_address, monitor_name, verbose
        self.extra: dict = {}
        self.lock = threading.Lock()
        self.online = False
        if start:
            threading.Thread(target=self._loop, daemon=True).start()

    def update(self, **values):
        """Report real values from your program, e.g. update(thermal=True, dht=True, air_temp=27.1)."""
        with self.lock:
            self.extra.update(values)

    def collect(self) -> dict:
        status = {
            "app": APP_NAME,
            "cpu_temp": cpu_temperature(),
            "uptime_s": uptime_seconds(),
            "ip": local_ip(),
            "camera": camera_ok(self.stream_health_url),
            "thermal": i2c_device_present(self.thermal_address),
            "monitor": program_running(self.monitor_name),
        }
        with self.lock:
            status.update(self.extra)  # values from horse_monitor.py win over automatic checks
        return {k: v for k, v in status.items() if v is not None}

    def beat_once(self) -> bool:
        try:
            send_heartbeat(self.url, self.key, self.device_key, self.collect())
            if self.verbose and not self.online:
                print(time.strftime("%H:%M:%S"), "✓ connected to the website")
            self.online = True
        except urllib.error.HTTPError as error:
            body = error.read().decode(errors="replace")
            print(time.strftime("%H:%M:%S"), f"✗ rejected ({error.code}): {body}")
            if "Unknown or inactive device" in body:
                print("   → Check DEVICE_KEY: copy it from Supabase → Table Editor → devices.")
            self.online = False
        except Exception as error:  # no internet, DNS, timeout… keep trying
            print(time.strftime("%H:%M:%S"), f"✗ cannot reach Supabase: {error}")
            self.online = False
        return self.online

    def _loop(self):
        while True:
            self.beat_once()
            time.sleep(self.interval)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tell the Horse Thermal Monitor website this Raspberry Pi is online")
    parser.add_argument("--url", default=os.environ.get("SUPABASE_URL"), help="https://YOUR-PROJECT.supabase.co")
    parser.add_argument("--key", default=os.environ.get("SUPABASE_KEY"), help="Supabase publishable/anon key")
    parser.add_argument("--device-key", default=os.environ.get("DEVICE_KEY"), help="device_key from the devices table")
    parser.add_argument("--interval", type=int, default=30, help="seconds between check-ins (website marks offline after 90 s)")
    parser.add_argument("--once", action="store_true", help="send one heartbeat, print the report, and exit (for testing)")
    args = parser.parse_args()

    missing = [name for name, value in (("--url", args.url), ("--key", args.key), ("--device-key", args.device_key)) if not value]
    if missing:
        parser.error("missing " + ", ".join(missing) + " (or set SUPABASE_URL / SUPABASE_KEY / DEVICE_KEY)")

    hb = Heartbeat(args.url, args.key, args.device_key, interval=args.interval, start=False)
    if args.once:
        report = hb.collect()
        print(json.dumps(report, indent=2))
        raise SystemExit(0 if hb.beat_once() else 1)

    print(f"Sending heartbeat every {args.interval}s to {args.url}  (Ctrl+C to stop)")
    hb._loop()
