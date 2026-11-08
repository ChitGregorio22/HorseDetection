"""
Horse Thermal Monitor — device uploader
=======================================
Runs on the thermal camera computer (e.g. Raspberry Pi) and sends each
temperature reading to Supabase. Only needs the PUBLIC anon key plus the
device's own secret key from the `devices` table — never put the
service_role key on the device.

Install:   pip install requests
Simulate:  python send_reading.py --simulate --horse HTM-THUNDER1
One-off:   python send_reading.py --horse HTM-THUNDER1 --body 37.8 --env 28.5

In your real camera code, import and call `send_reading(...)` after the
AI model has measured the horse's temperature.
"""
import argparse
import random
import time

import requests

# ---- Fill these in (Supabase → Project Settings → API) ----
SUPABASE_URL = "https://YOUR-PROJECT-ID.supabase.co"
SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY"
DEVICE_KEY = "demo-device-key-change-me"  # from the devices table


def send_reading(horse_code: str, body_temp: float, env_temp: float | None = None) -> dict:
    """Send one reading. Returns {'reading_id', 'horse_id', 'body_temp', 'status'}."""
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/submit_reading",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "p_device_key": DEVICE_KEY,
            "p_horse_code": horse_code,
            "p_body_temp": round(body_temp, 1),
            "p_env_temp": None if env_temp is None else round(env_temp, 1),
        },
        timeout=10,
    )
    if not response.ok:
        raise RuntimeError(f"Upload failed ({response.status_code}): {response.text}")
    return response.json()


def simulate(horse_code: str, interval: float, fever: bool) -> None:
    """Sends fake readings so you can demo the live dashboard without the camera."""
    temp = 37.2
    print(f"Simulating {horse_code} every {interval}s. Press Ctrl+C to stop.")
    while True:
        drift = 0.08 if fever else 0.0
        temp = min(39.5, max(36.8, temp + drift + random.uniform(-0.1, 0.1)))
        env = 27 + random.uniform(-2, 3)
        result = send_reading(horse_code, temp, env)
        print(f"{time.strftime('%H:%M:%S')}  body {result['body_temp']}°C  env {env:.1f}°C  -> {result['status'].upper()}")
        time.sleep(interval)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send horse temperature readings to Supabase")
    parser.add_argument("--horse", required=True, help="Horse code printed on the QR tag, e.g. HTM-THUNDER1")
    parser.add_argument("--body", type=float, help="Body temperature in °C")
    parser.add_argument("--env", type=float, help="Environment temperature in °C")
    parser.add_argument("--simulate", action="store_true", help="Keep sending fake readings")
    parser.add_argument("--fever", action="store_true", help="With --simulate: make the temperature climb into fever")
    parser.add_argument("--interval", type=float, default=3, help="Seconds between simulated readings")
    args = parser.parse_args()

    if args.simulate:
        simulate(args.horse, args.interval, args.fever)
    elif args.body is not None:
        print(send_reading(args.horse, args.body, args.env))
    else:
        parser.error("give --body (and optionally --env), or use --simulate")
