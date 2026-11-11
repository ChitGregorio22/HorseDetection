"""
web_link.py — connects horse_monitor.py to the website (Supabase).

With  python3 thesisv2.py --web ...  (or horse_monitor.py) the monitor:
  * picks up "Register a horse" requests made on the website and runs its normal fingerprint
    registration (30 photos, view checklist), sending live progress to the website,
  * when done, creates the horse on the website with one of its crops as the photo and remembers
    the website's horse ID (horse_code) in horses.db, so later readings attach to the right horse,
  * every ~2 s tells the website what the camera sees right now (which horse, how sure, its
    temperature, air temperature, humidity): the Dashboard follows it live,
  * every minute uploads one reading per IDENTIFIED horse (median of that minute: body temp,
    air temp, humidity) for History, trends and fever alerts. Unidentified / uncertain horses
    are never uploaded under a name,
  * reports a heartbeat every 30 s ("Raspberry Pi: Online" + camera / thermal / DHT22 status).

All website logic lives in THIS file: the monitor script only calls web.tick(globals()) once per
frame (added by add_web_link.py), so updating web_link.py never needs the script to be patched again.

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

POLL_SEC = 2.0          # how often to ask "anything to register?" / send progress / live view
HEARTBEAT_SEC = 30.0    # website shows Offline after 90 s without one
LIVE_SEC = 2.0          # live view ("Bella in the stall, 37.9 C") at most this often
UPLOAD_SEC = 60.0       # one stored reading per identified horse per minute
MIN_SAMPLES = 5         # a minute needs at least this many temperature samples to be uploaded


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
        self.live_latest = None           # newest live-view state, not sent yet
        self.readings = queue.Queue()     # per-minute readings waiting to be uploaded
        self.dead_codes = set()           # horse IDs the website doesn't know (deleted there)
        self._codes, self._codes_t = {}, 0.0          # local name -> website horse_code
        self._acc, self._acc_t0 = {}, time.time()      # horse_code -> samples this minute
        self._last_live = 0.0
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
                with self.lock:
                    live, self.live_latest = self.live_latest, None
                if live is not None:
                    try:
                        self.rpc("device_live", p_device_key=self.device_key, p_state=live)
                    except urllib.error.HTTPError as e:
                        if e.code == 404:          # update 08 not installed yet: live view is optional
                            if not getattr(self, "_warned_live", False):
                                print("Web link: live view needs supabase/08_live_view.sql (skipping it for now)")
                                self._warned_live = True
                        else:
                            raise
                self._send_readings()
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

    def _send_readings(self):
        sent = 0
        while sent < 20:
            try:
                r = self.readings.get_nowait()
            except queue.Empty:
                return
            try:
                self.rpc("submit_reading", p_device_key=self.device_key, p_horse_code=r["code"],
                         p_body_temp=r["body"], p_env_temp=r["air"], p_humidity=r["rh"])
                sent += 1
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if "Unknown horse code" in text:   # horse removed on the website: drop, don't retry forever
                    if r["code"] not in self.dead_codes:
                        print(time.strftime("%H:%M:%S"), f"Web link: the website doesn't know {r['name']} "
                              f"({r['code']}) any more - its readings are kept on the Pi only")
                    self.dead_codes.add(r["code"])
                    continue
                self.readings.put(r)
                raise RuntimeError(f"{e.code} {text[:160]}")
            except Exception:
                self.readings.put(r)               # offline: keep it, try again later
                raise

    # ------------------------------------------------------------ the one call from the monitor script
    def tick(self, g):
        """Called once per frame with the monitor script's globals(): registrations, live view,
        per-minute readings and heartbeat details. Never blocks: the network is in the background."""
        args, db = g["args"], g["db"]
        now_t = time.time()
        for local_name, code in self.poll_results():           # website gave a new horse its ID
            db.execute("UPDATE horses SET horse_code = ? WHERE name = ?", (code, local_name))
            db.commit()
            self._codes[local_name] = code
        if now_t - self._codes_t > 30:
            self._codes = {n: c for n, c in db.execute("SELECT name, horse_code FROM horses WHERE horse_code IS NOT NULL")}
            self._codes_t = now_t
        air, rh = g["ambient"]() if "ambient" in g else (None, None)
        if g.get("frame_no", 0) % 10 == 0:                     # heartbeat details (sent every 30 s)
            thermal = None
            if getattr(args, "thermal", False) and "thermal_frame" in g:
                thermal = g["thermal_frame"]() is not None
            cpu = g["cpu_temp"]() if "cpu_temp" in g else None
            self.set_status(app="thesisv2.py --web" if "thesis" in str(g.get("__file__", "")) else "horse_monitor.py --web",
                            camera=True, thermal=thermal, dht=(air is not None) if getattr(args, "dht", False) else None,
                            air_temp=None if air is None else round(air, 1), humidity=None if rh is None else round(rh, 1),
                            cpu_temp=None if cpu is None or cpu != cpu else round(cpu, 1),
                            registering=g.get("mode") == "registering", monitor=True,
                            monitor_detail=f"YOLO {g.get('t_yolo', 0):.0f} ms, {'horse' if g.get('present') else 'no horse'}")
        self._registration(g)
        self._live_and_readings(g, air, rh, now_t)

    def _live_and_readings(self, g, air, rh, now_t):
        mode = g.get("mode")
        horses = []
        if mode in ("recognise", "typing"):
            for tid, t in list(g.get("tracks", {}).items()):
                if now_t - t.get("seen_t", 0) > 3.0:           # not in view any more
                    continue
                if t.get("source") == "id":
                    status, name = "identified", t.get("name")
                elif t.get("name") == "unknown":
                    status, name = "unknown", None
                else:
                    status, name = "identifying", None
                code = self._codes.get(name) if name else None
                temp, surface = t.get("temp"), t.get("surface")
                best = t.get("best")
                horses.append({
                    "status": status, "name": name, "horse_code": code,
                    "confidence": round(float(t.get("sim", 0)), 2) if status == "identified" else None,
                    "best_guess": best[0] if status == "unknown" and best else None,
                    "body_temp": None if temp is None else round(float(temp), 2),
                    "surface_temp": None if surface is None else round(float(surface), 2),
                    "identifying": len(t.get("embs", [])) if status == "identifying" else None,
                })
                # per-minute reading: only a confidently IDENTIFIED horse that is on the website
                if status == "identified" and code and temp is not None and code not in self.dead_codes:
                    self._acc.setdefault(code, {"name": name, "s": []})["s"].append(
                        (float(temp), air, rh))
        if now_t - self._acc_t0 >= UPLOAD_SEC:
            for code, a in self._acc.items():
                s = a["s"]
                if len(s) >= MIN_SAMPLES:
                    med = lambda xs: None if not xs else round(sorted(xs)[len(xs) // 2], 2)  # noqa: E731
                    self.readings.put({"code": code, "name": a["name"], "body": med([x[0] for x in s]),
                                       "air": med([x[1] for x in s if x[1] is not None]),
                                       "rh": med([x[2] for x in s if x[2] is not None])})
            if self.readings.qsize() > 2000:                     # offline for a long time: keep the newest
                for _ in range(self.readings.qsize() - 2000):
                    self.readings.get_nowait()
            self._acc, self._acc_t0 = {}, now_t
        if now_t - self._last_live >= LIVE_SEC:
            state = {"present": bool(g.get("present")), "horses": horses, "mode": mode,
                     "air_temp": None if air is None else round(air, 1),
                     "humidity": None if rh is None else round(rh, 1),
                     "registering": g.get("reg_name") if mode == "registering" else None,
                     "time": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
            with self.lock:
                self.live_latest = state
            self._last_live = now_t

    def _registration(self, g):
        """Website 'Register a horse' requests (started, progress, cancelled, result)."""
        args = g["args"]
        mode = g.get("mode")
        req = g.get("remote_req")
        if req is None:
            self.want_work = mode == "recognise"
            cmd = self.take_command() if mode == "recognise" else None
            if cmd:
                g["remote_req"], g["remote_result"] = cmd, None
                g["remote_force_was"], args.force = args.force, bool(cmd.get("force"))
                g["start_registration"](cmd["name"])
                self.progress(cmd["id"], {"photos": 0, "needed": args.samples, "need_views": g.get("NEED"),
                                          "views": g["view_counts"](), "missing": g["views_missing"]()},
                              f"Registering {cmd['name']}: turn the horse slowly all the way round")
            return
        rid = req["id"]
        if self.cancelled(rid):                                 # cancelled on the website
            if g.get("mode") == "registering":
                g["mode"] = "recognise"
                g["say"](f"Registration of {g.get('reg_name')} cancelled from the website, nothing saved")
            g["remote_req"], args.force = None, g.get("remote_force_was", False)
            self.finish_failed(rid, "Cancelled.", kind="cancelled")
            return
        if mode == "registering":
            embs, note = g.get("reg_embs", []), g.get("reg_note", "")
            polys = g.get("polys")
            self.progress(rid, {"photos": len(embs), "needed": args.samples, "views": g["view_counts"](),
                                "need_views": g.get("NEED"), "missing": g["views_missing"](), "note": note,
                                "horses_in_view": len(polys) if polys is not None else None},
                          f"Photo {len(embs)}/{args.samples}" + (f" - {note}" if note else ""))
            return
        result = g.get("remote_result")                         # the registration has ended
        embs = g.get("reg_embs", [])
        if result is None:
            self.finish_failed(rid, "Registration was stopped on the Pi before it finished. Nothing saved.")
        else:
            saved, other, sim = result
            if saved:
                self.finish_success(req, g.get("reg_name"), pick_profile_crop(g.get("reg_crops", []), g.get("reg_info", [])),
                                    len(embs))
            elif other:
                self.finish_failed(rid, f"Not saved: this horse looks like {other} (similarity {sim:.2f}). "
                                        f"If it really is a different horse, press 'Register anyway'.")
            else:
                self.finish_failed(rid, f"Not saved: only {len(embs)} usable photos. Keep one whole horse in view "
                                        f"and turn it slowly, then try again.")
        if g.get("mode") == "confirm":
            g["mode"] = "recognise"
        g["remote_req"], g["remote_result"], args.force = None, None, g.get("remote_force_was", False)

    # ------------------------------------------------------------ used by tick() (main thread)
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
