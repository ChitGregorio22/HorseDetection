"""
web_link.py — connects horse_monitor.py to the website (Supabase).

With  python3 horse_monitor.py --web ...  the monitor:
  * picks up "Register a horse" requests made on the website and runs its normal fingerprint
    registration (30 photos, view checklist), sending live progress to the website,
  * when done, creates the horse on the website with one of its crops as the photo and remembers
    the website's horse ID (horse_code) in horses.db, so later readings attach to the right horse,
  * reports a heartbeat every 30 s ("Raspberry Pi: Online" + camera / thermal / DHT22 status).

Settings: a file  web.env  next to horse_monitor.py (keep it private, never upload it):
    SUPABASE_URL=https://YOUR-PROJECT.supabase.co
    SUPABASE_KEY=sb_publishable_...        (the public "publishable"/anon key, NOT the secret key)
    DEVICE_KEY=...                         (from Supabase → devices table)

Extra tool (run by itself, while horse_monitor.py is stopped or running):
    python3 web_link.py --test             check the connection
    python3 web_link.py --push-existing    put horses registered on the Pi before (e.g. with r) on the website

Only uses the Python standard library + OpenCV (already installed for horse_monitor.py).
"""
import base64
import json
import os
import queue
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

POLL_SEC = 2.0          # how often to ask "anything to register?" / send progress
HEARTBEAT_SEC = 30.0    # website shows Offline after 90 s without one


def read_env(path):
    """KEY=VALUE lines → dict (environment variables with the same names win)."""
    values = {}
    p = Path(path)
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("SUPABASE_URL", "SUPABASE_KEY", "DEVICE_KEY"):
        if os.environ.get(k):
            values[k] = os.environ[k]
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_KEY", "DEVICE_KEY") if not values.get(k)]
    if missing:
        raise SystemExit(f"--web: missing {', '.join(missing)} in {p.resolve()} (see web_link.py for the format)")
    return values


class WebLink:
    def __init__(self, url, key, device_key, db=None, verbose=True):
        self.url, self.key, self.device_key, self.verbose = url.rstrip("/"), key, device_key, verbose
        self.lock = threading.Lock()
        self.inbox = None                 # request taken from the website, waiting for the main loop
        self.want_work = True             # main loop is free to start a registration
        self.current_id = None            # request being registered right now
        self.progress_latest = None       # (id, progress, message) not sent yet
        self.cancelled_ids = set()
        self.jobs = queue.Queue()         # finish / fail messages to send
        self.results = queue.Queue()      # (local name, horse_code) to save in horses.db (main thread)
        self.status = {"app": "horse_monitor.py --web", "monitor": True}
        self.online = None
        self.last_beat = 0.0
        if db is not None:                # remember the website's horse ID next to each local horse
            cols = [r[1] for r in db.execute("PRAGMA table_info(horses)")]
            if "horse_code" not in cols:
                db.execute("ALTER TABLE horses ADD COLUMN horse_code TEXT")
                db.commit()
        threading.Thread(target=self._loop, daemon=True).start()
        print(f"Web link: {self.url} (registrations from the website, heartbeat every {HEARTBEAT_SEC:.0f} s)")

    @classmethod
    def from_env(cls, env_path, db=None):
        v = read_env(env_path)
        return cls(v["SUPABASE_URL"], v["SUPABASE_KEY"], v["DEVICE_KEY"], db)

    # ------------------------------------------------------------ calls to Supabase
    def rpc(self, fn, **params):
        req = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/{fn}",
            data=json.dumps(params).encode(),
            headers={"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read()
        return json.loads(body) if body else None

    def _report_connection(self, ok, error=None):
        if ok and self.online is not True:
            print(time.strftime("%H:%M:%S"), "Web link: connected to the website")
        elif not ok and self.online is not False:
            hint = ""
            if isinstance(error, urllib.error.HTTPError):
                text = error.read().decode(errors="replace")
                if "Unknown or inactive device" in text:
                    hint = " → wrong DEVICE_KEY in web.env"
                elif "device_take_registration" in text or "does not exist" in text:
                    hint = " → run supabase/07_remote_registration.sql in Supabase"
                error = f"{error.code} {text[:160]}"
            print(time.strftime("%H:%M:%S"), f"Web link: can't reach the website ({error}){hint}. Retrying…")
        self.online = ok

    # ------------------------------------------------------------ background thread
    def _loop(self):
        while True:
            try:
                self._send_jobs()
                with self.lock:
                    latest, self.progress_latest = self.progress_latest, None
                    take = self.want_work and self.inbox is None and self.current_id is None
                if latest:
                    rid, progress, message = latest
                    status = self.rpc("device_update_registration", p_device_key=self.device_key, p_id=rid,
                                      p_status="running", p_progress=progress, p_message=message)
                    if status in ("cancelled", "missing", "failed"):
                        with self.lock:
                            self.cancelled_ids.add(rid)
                if take:
                    cmd = self.rpc("device_take_registration", p_device_key=self.device_key)
                    if cmd:
                        with self.lock:
                            self.inbox = cmd
                if time.time() - self.last_beat >= HEARTBEAT_SEC:
                    with self.lock:
                        status = dict(self.status)
                    self.rpc("device_heartbeat", p_device_key=self.device_key, p_status=status)
                    self.last_beat = time.time()
                self._report_connection(True)
            except Exception as e:          # no internet, Supabase paused… keep going, try again
                self._report_connection(False, e)
                time.sleep(5)
            time.sleep(POLL_SEC)

    def _send_jobs(self):
        while True:
            try:
                job = self.jobs.get_nowait()
            except queue.Empty:
                return
            try:
                if job["kind"] == "done":
                    res = self.rpc("device_register_horse", p_device_key=self.device_key, p_name=job["name"],
                                   p_age=job.get("age"), p_normal_temp=job.get("normal_temp"),
                                   p_photo=job.get("photo"), p_request_id=job.get("id"), p_photos=job.get("photos"))
                    self.results.put((job["local_name"], res["horse_code"]))
                    print(time.strftime("%H:%M:%S"), f"Web link: {job['name']} is on the website as {res['horse_code']}")
                else:
                    self.rpc("device_update_registration", p_device_key=self.device_key, p_id=job["id"],
                             p_status=job["kind"], p_progress=job.get("progress"), p_message=job["message"])
            except Exception:
                self.jobs.put(job)              # keep it and try again next round
                raise

    # ------------------------------------------------------------ used by horse_monitor.py (main thread)
    def take_command(self):
        """A website registration request ({id, name, age, normal_temp, force}) or None."""
        with self.lock:
            cmd, self.inbox = self.inbox, None
            if cmd:
                self.current_id = cmd["id"]
        return cmd

    def progress(self, rid, progress, message=None):
        with self.lock:
            self.progress_latest = (rid, progress, message)

    def cancelled(self, rid):
        with self.lock:
            return rid in self.cancelled_ids

    def finish_success(self, req, local_name, crop_bgr, photos):
        self.jobs.put({"kind": "done", "id": req["id"], "name": req["name"], "local_name": local_name,
                       "age": req.get("age"), "normal_temp": req.get("normal_temp"),
                       "photo": to_data_url(crop_bgr), "photos": photos})
        self._release()

    def finish_failed(self, rid, message, kind="failed"):
        self.jobs.put({"kind": kind, "id": rid, "message": message})
        self._release()

    def _release(self):
        with self.lock:
            self.current_id, self.progress_latest = None, None

    def poll_results(self):
        out = []
        while True:
            try:
                out.append(self.results.get_nowait())
            except queue.Empty:
                return out

    def set_status(self, **values):
        with self.lock:
            self.status.update({k: v for k, v in values.items() if v is not None})


def to_data_url(bgr, size=320, quality=85):
    """Crop (BGR image) → small JPEG 'data:image/jpeg;base64,…' for the website's horse photo."""
    if bgr is None:
        return None
    import cv2

    h, w = bgr.shape[:2]
    scale = size / max(h, w)
    if scale < 1:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, enc = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return "data:image/jpeg;base64," + base64.b64encode(enc.tobytes()).decode() if ok else None


def pick_profile_crop(crops, info):
    """Best photo for the website: the biggest 'angled' view (how the stall camera sees the horse), else any."""
    if not crops:
        return None
    order = {"angled": 0, "side": 1, "front-back": 2}
    best = min(range(len(crops)), key=lambda i: (order.get(info[i][0], 3), -(info[i][1] or 0)))
    return crops[best]


# ---------------------------------------------------------------- command line tools
if __name__ == "__main__":
    import argparse
    import sqlite3

    ap = argparse.ArgumentParser(description="Website link for horse_monitor.py")
    ap.add_argument("--env", default="web.env")
    ap.add_argument("--db", default="horse_db/horses.db")
    ap.add_argument("--test", action="store_true", help="check the connection and exit")
    ap.add_argument("--push-existing", action="store_true",
                    help="create website entries for horses registered on the Pi that aren't on the website yet")
    a = ap.parse_args()
    v = read_env(a.env)
    link = WebLink.__new__(WebLink)             # no background thread for the tools
    link.url, link.key, link.device_key = v["SUPABASE_URL"].rstrip("/"), v["SUPABASE_KEY"], v["DEVICE_KEY"]

    if a.test or not a.push_existing:
        try:
            link.rpc("device_heartbeat", p_device_key=link.device_key, p_status={"app": "web_link.py --test"})
            print("✓ Connected: the website now shows this Pi as Online.")
            link.rpc("device_update_registration", p_device_key=link.device_key, p_id=0)
            print("✓ Remote registration is installed in the database.")
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")
            print(f"✗ {e.code}: {text[:300]}")
            if "Unknown or inactive device" in text:
                print("  → DEVICE_KEY in web.env is wrong (copy it from Supabase → Table Editor → devices)")
            elif "device_update_registration" in text or "device_heartbeat" in text:
                print("  → run supabase/04_device_status.sql and 07_remote_registration.sql in Supabase")
            raise SystemExit(1)
        except Exception as e:
            raise SystemExit(f"✗ Can't reach {link.url}: {e}")

    if a.push_existing:
        import cv2

        db = sqlite3.connect(a.db)
        if "horse_code" not in [r[1] for r in db.execute("PRAGMA table_info(horses)")]:
            db.execute("ALTER TABLE horses ADD COLUMN horse_code TEXT")
        rows = db.execute("SELECT id, name FROM horses WHERE horse_code IS NULL OR horse_code = '' ORDER BY name").fetchall()
        if not rows:
            print("Every horse in", a.db, "is already on the website.")
        for hid, name in rows:
            crops = db.execute("SELECT crop_path, view, size FROM embeddings WHERE horse_id = ? AND crop_path IS NOT NULL",
                               (hid,)).fetchall()
            imgs = [(cv2.imread(p), (view or "", size)) for p, view, size in crops if p and Path(p).exists()]
            imgs = [(im, inf) for im, inf in imgs if im is not None]
            photo = pick_profile_crop([i[0] for i in imgs], [i[1] for i in imgs]) if imgs else None
            res = link.rpc("device_register_horse", p_device_key=link.device_key, p_name=name, p_photo=to_data_url(photo))
            db.execute("UPDATE horses SET horse_code = ? WHERE id = ?", (res["horse_code"], hid))
            db.commit()
            print(f"✓ {name} → {res['horse_code']}" + ("" if photo is not None else " (no photo found)"))
        print("Done. Set each horse's age and normal temperature on the website (Horses → Edit).")
