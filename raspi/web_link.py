"""
web_link.py — connects horse_monitor.py to the website (Supabase).

With  python3 thesisv2.py --web ...  (or horse_monitor.py) the monitor:
  * picks up "Register a horse" requests made on the website and runs its normal fingerprint
    registration (30 photos, view checklist), sending live progress to the website,
  * when done, creates the horse on the website with one of its crops as the photo and remembers
    the website's horse ID (horse_code) in horses.db, so later readings attach to the right horse,
  * tells the website what the camera sees RIGHT NOW: thesisv2.py calls web.set_live({...}) every
    frame (YOLO sees a horse? who, named by fingerprint or QR plate, temperatures, DHT22). A change
    (horse arrives / leaves / is named / QR plate read) goes out within ~0.5 s, otherwise every 2 s,
    so the Dashboard's "In the stall now" is live (supabase/08_live_view.sql),
  * uploads the readings the script hands it: every 5 s horse_monitor.py / thesisv2.py passes the oldest
    unsent CONFIRMED readings from horses.db to web.queue_reading({...}) (final body temp, surface temp,
    air temp, humidity, recorded_at, fingerprint/QR). queue_reading() never blocks; a background thread
    sends them in batches with device_submit_readings (supabase/09_pi_readings_batch.sql) and reports
    each result through web.poll_uploaded() -> [(local_id, True, None), (local_id, False, "why"), ...].
    The Pi marks a reading as sent only after (local_id, True, None): horses.db is the backup, so a
    reading lost in a crash or outage is simply handed over again, and the website ignores repeats.
    (Older scripts without queue_reading(): web_link makes one reading per identified horse per
    minute itself.) Unidentified / uncertain horses are never uploaded under a name,
  * profile photos: at the end of a registration, up to 6 whole-camera pictures (photo_options) go to
    the website (about 1280 px JPEG, one per call, table horse_photos: supabase/10_profile_photos.sql);
    "Take profile photo" on the website → take_photo_request() / send_profile_photo() (also the p key),
  * reports a heartbeat every 30 s ("Raspberry Pi: Online" + camera / thermal / DHT22 status).

thesisv2.py already has --web built in (don't run add_web_link.py on it). For older scripts,
add_web_link.py adds a one-line web.tick(globals()) per frame.

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
LIVE_SEC = 2.0          # live view refresh while nothing changes (the website calls it stale after 15 s)
LIVE_MIN_GAP = 0.4      # a change is sent at once, but not more often than this
UPLOAD_SEC = 60.0       # older scripts only: one reading per identified horse per minute
MIN_SAMPLES = 5         # older scripts only: a minute needs at least this many temperature samples
BATCH_MAX = 30          # readings per call to device_submit_readings
PHOTO_PX = 1280         # profile pictures: long side, JPEG quality 80 (~150-300 KB)
THUMB_PX = 400          # card thumbnail kept on the horse
PENDING_MAX = 5000      # in memory only (horses.db is the backup): beyond that the oldest are dropped


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
        self.photo_jobs = queue.Queue()   # pictures to upload (own thread: big, can be slow)
        self.photo_inbox = None           # "Take profile photo" request waiting for the main loop
        self._photo_wanted_t = 0.0        # last time the script asked take_photo_request()
        self._photo_off_until = 0.0       # 10_profile_photos.sql missing: don't ask for a while
        self.results = queue.Queue()      # (local name, horse_code) to save in horses.db (main thread)
        self.status = {"app": "horse_monitor.py --web", "monitor": True}
        self.online = None
        self.last_beat = 0.0
        self.live_latest = None           # newest live-view state, not sent yet
        self._live_key = None             # what the last state "means" (who, how), to spot changes
        self._live_event = threading.Event()
        self._live_sent_t = 0.0
        self.pending = {}                 # local_id -> reading waiting to be sent (in memory; horses.db is the backup)
        self.pending_lock = threading.Lock()
        self.uploaded = queue.Queue()     # (local_id, ok, error) for poll_uploaded()
        self._noid = 0                    # key for readings without a local_id (older scripts via tick())
        self.external_readings = None     # True = the script calls queue_reading() itself (thesisv2.py)
        self.dead_codes = set()           # horse IDs the website doesn't know (deleted there)
        self.readings_sent = 0
        self._codes, self._codes_t = {}, 0.0          # local name -> website horse_code
        self._acc, self._acc_t0 = {}, time.time()      # horse_code -> samples this minute
        self._last_live = 0.0
        if db is not None:                # remember the website's horse ID next to each local horse
            cols = [r[1] for r in db.execute("PRAGMA table_info(horses)")]
            if "horse_code" not in cols:
                db.execute("ALTER TABLE horses ADD COLUMN horse_code TEXT")
                db.commit()
        threading.Thread(target=self._loop, daemon=True).start()
        threading.Thread(target=self._reading_loop, daemon=True).start()
        threading.Thread(target=self._photo_loop, daemon=True).start()
        threading.Thread(target=self._live_loop, daemon=True).start()
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
        # an HTTP error (other than a wrong key) still means the website is reachable
        self.online = ok or (isinstance(error, urllib.error.HTTPError) and error.code not in (401, 403))

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
                self._poll_photo_request()
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
                    if "photo" not in job:                      # encode here, not in the camera loop
                        job["photo"] = to_data_url(job.get("photo_img"), THUMB_PX, 75)
                    res = self.rpc("device_register_horse", p_device_key=self.device_key, p_name=job["name"],
                                   p_age=job.get("age"), p_normal_temp=job.get("normal_temp"),
                                   p_photo=job.get("photo"), p_request_id=job.get("id"), p_photos=job.get("photos"))
                    code = res["horse_code"]
                    self.results.put((job["local_name"], code))
                    print(time.strftime("%H:%M:%S"), f"Web link: {job['name']} is on the website as {code}")
                    for k, (img, is_profile) in enumerate(job.get("pictures", [])):   # profile photo choices
                        self.photo_jobs.put({"horse_code": code, "img": img, "source": "registration",
                                             "make_profile": is_profile, "label": f"{job['name']} photo {k + 1}"})
                else:
                    self.rpc("device_update_registration", p_device_key=self.device_key, p_id=job["id"],
                             p_status=job["kind"], p_progress=job.get("progress"), p_message=job["message"])
            except Exception:
                self.jobs.put(job)              # keep it and try again next round
                raise

    # ------------------------------------------------------------ live view (thesisv2.py: web.set_live)
    def set_live(self, state):
        """Every frame (never blocks): what the camera sees right now.
            {"present": True,                      # YOLO sees a horse (in the stall zone)
             "horses": [{"status": "identified",   # or "identifying" (being checked) / "unknown" (not registered)
                         "name": "Jafar", "horse_code": "HTM-92578BC8",
                         "method": "qr",            # or "fingerprint"
                         "confidence": 0.84,        # fingerprint similarity (None for QR)
                         "progress": {"photos": 3, "photos_needed": 8, "checks": 1, "checks_needed": 3},
                                                    # only while "identifying"
                         "qr_check": "match",       # only when identified: match / mismatch /
                                                    # unregistered plate / fallback / None
                         "body_temp": 37.8, "surface_temp": 33.1}],
             "qr": ["HTM-92578BC8"],                # QR plates read in this frame (optional)
             "air_temp": 26.4, "humidity": 78.0,    # DHT22 (None if no reading)
             "mode": "recognise"}                   # or "registering" (+ "registering": "Name")
        A change in who / how / present / progress step / QR check is sent within ~0.4 s (never more often,
        LIVE_MIN_GAP); otherwise the latest state every 2 s."""
        st = dict(state)
        st.setdefault("time", time.strftime("%Y-%m-%dT%H:%M:%S%z"))
        horses = st.get("horses") or []
        key = (bool(st.get("present")), st.get("mode"), tuple(sorted(st.get("qr") or [])),
               tuple((h.get("status"), h.get("name"), h.get("method"),
                      json.dumps(h.get("progress"), sort_keys=True), h.get("qr_check")) for h in horses))
        with self.lock:
            self.live_latest = st
            changed = key != self._live_key
            self._live_key = key
        if changed:
            self._live_event.set()

    def _live_loop(self):
        warned = False
        while True:
            since = time.time() - self._live_sent_t
            changed = self._live_event.wait(timeout=max(0.05, LIVE_SEC - since))
            if changed:
                gap = LIVE_MIN_GAP - (time.time() - self._live_sent_t)
                if gap > 0:
                    time.sleep(gap)
                self._live_event.clear()
            elif time.time() - self._live_sent_t < LIVE_SEC:
                continue
            with self.lock:
                live = self.live_latest
            if live is None:
                continue
            self._live_sent_t = time.time()
            try:
                self.rpc("device_live", p_device_key=self.device_key, p_state=live)
            except urllib.error.HTTPError as e:
                if e.code == 404 and not warned:       # update 08 not installed: live view is optional
                    print("Web link: the live view needs supabase/08_live_view.sql (skipping it for now)")
                    warned = True
                if e.code == 404:
                    self._live_sent_t = time.time() + 60    # ask again in a minute
            except Exception:
                self._live_sent_t = time.time() + 3         # offline: the heartbeat/readings report it

    # ------------------------------------------------------------ readings (thesisv2.py: web.queue_reading)
    def queue_reading(self, reading, _from_script=True):
        """Hand over one stored reading. Never blocks. Keys: local_id, horse_code, body_temp, surface_temp,
        air_temp, humidity, recorded_at (ISO text), method ('fingerprint' | 'qr'). The same local_id handed over
        again (still unsent, or sent but not yet confirmed) replaces the earlier copy: it is sent once."""
        if _from_script:
            self.external_readings = True
        r = dict(reading)
        key = r.get("local_id")
        with self.pending_lock:
            if key is None:
                self._noid += 1
                key = ("noid", self._noid)
            self.pending[key] = r
            while len(self.pending) > PENDING_MAX:          # keep the newest; the Pi still has the rest in horses.db
                self.pending.pop(next(iter(self.pending)))

    def poll_uploaded(self):
        """Results since the last call: [(local_id, True, None), (local_id, False, "Unknown horse code: …"), …].
        Only (local_id, True, None) means the website has the reading (new or already stored before)."""
        out = []
        while True:
            try:
                out.append(self.uploaded.get_nowait())
            except queue.Empty:
                return out

    def _reading_loop(self):
        wait, use_single, warned = 1.0, False, False
        while True:
            time.sleep(wait)
            with self.pending_lock:
                batch = list(self.pending.items())[:BATCH_MAX]
            if not batch:
                wait = 1.0
                continue
            try:
                if use_single:
                    results = self._send_single([r for _, r in batch])
                else:
                    results = self.rpc("device_submit_readings", p_device_key=self.device_key,
                                       p_readings=[r for _, r in batch])
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if e.code == 404 and "device_submit_readings" in text and not use_single:
                    # 09_pi_readings_batch.sql not run yet: send one by one with 08's device_submit_reading
                    if not warned:
                        print(time.strftime("%H:%M:%S"), "Web link: no batch upload yet (run supabase/09_pi_readings_batch.sql)"
                              " - sending readings one at a time")
                        warned = True
                    use_single, wait = True, 0.2
                    continue
                print(time.strftime("%H:%M:%S"), f"Web link: readings not sent ({e.code} {text[:160]}), trying again")
                if e.code in (401, 403):
                    self.online = False
                wait = min(60.0, max(5.0, wait * 2))
                continue
            except Exception as e:                       # no internet: keep them, try again slower and slower
                if self.online is not False:
                    print(time.strftime("%H:%M:%S"), f"Web link: readings wait for the internet ({e})")
                self.online = False
                wait = min(60.0, max(5.0, wait * 2))
                continue
            self.online = True
            wait = 0.2 if len(batch) == BATCH_MAX else 1.0  # more waiting: go on straight away
            by_id = {}
            for res in results or []:
                by_id.setdefault(res.get("local_id"), res)
            with self.pending_lock:
                for key, r in batch:
                    res = by_id.get(r.get("local_id"), {"ok": False, "error": "no answer for this reading"})
                    ok = bool(res.get("ok"))
                    err = None if ok else str(res.get("error") or "refused")
                    if ok:
                        self.readings_sent += 1
                    elif "Unknown horse code" in err and r.get("horse_code") not in self.dead_codes:
                        self.dead_codes.add(r.get("horse_code"))
                        print(time.strftime("%H:%M:%S"), f"Web link: the website doesn't know {r.get('horse_code')}")
                    if self.pending.get(key) is r:           # not replaced by a newer copy meanwhile
                        del self.pending[key]
                    if r.get("local_id") is not None:
                        self.uploaded.put((r.get("local_id"), ok, err))

    def _send_single(self, readings):
        """Fallback before 09_pi_readings_batch.sql: 08's device_submit_reading, one call per reading."""
        out = []
        for r in readings:
            try:
                self.rpc("device_submit_reading", p_device_key=self.device_key,
                         p_horse_code=r.get("horse_code"), p_body_temp=r.get("body_temp"),
                         p_surface_temp=r.get("surface_temp"), p_env_temp=r.get("air_temp"),
                         p_humidity=r.get("humidity"), p_recorded_at=r.get("recorded_at"),
                         p_method=r.get("method"), p_local_id=r.get("local_id"))
                out.append({"local_id": r.get("local_id"), "ok": True})
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                try:
                    msg = json.loads(text).get("message") or text
                except ValueError:
                    msg = text
                if e.code in (401, 403) or (e.code >= 500 and "Unknown horse code" not in msg
                                            and "violates" not in msg):
                    raise RuntimeError(f"{e.code} {msg[:160]}") from None     # wrong key / server trouble: retry later
                out.append({"local_id": r.get("local_id"), "ok": False, "error": msg[:200]})
        return out

    # ------------------------------------------------------------ the one call from the monitor script
    def tick(self, g):
        """Called once per frame with the monitor script's globals(): registrations, live view,
        per-minute readings and heartbeat details. Never blocks: the network is in the background."""
        args, db = g["args"], g["db"]
        now_t = time.time()
        if self.external_readings is None:                     # does the script send its own readings?
            try:
                self.external_readings = "queue_reading" in Path(g.get("__file__", "")).read_text()
            except OSError:
                self.external_readings = False
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
                if (status == "identified" and code and temp is not None and code not in self.dead_codes
                        and not self.external_readings):
                    self._acc.setdefault(code, {"name": name, "s": []})["s"].append(
                        (float(temp), air, rh))
        if now_t - self._acc_t0 >= UPLOAD_SEC:
            for code, a in self._acc.items():
                s = a["s"]
                if len(s) >= MIN_SAMPLES:
                    med = lambda xs: None if not xs else round(sorted(xs)[len(xs) // 2], 2)  # noqa: E731
                    self.queue_reading({"horse_code": code, "body_temp": med([x[0] for x in s]),
                                        "air_temp": med([x[1] for x in s if x[1] is not None]),
                                        "humidity": med([x[2] for x in s if x[2] is not None]),
                                        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                                        "method": "fingerprint"}, _from_script=False)
            self._acc, self._acc_t0 = {}, now_t
        if now_t - self._last_live >= LIVE_SEC:
            state = {"present": bool(g.get("present")), "horses": horses, "mode": mode,
                     "air_temp": None if air is None else round(air, 1),
                     "humidity": None if rh is None else round(rh, 1),
                     "registering": g.get("reg_name") if mode == "registering" else None,
                     "time": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
            self.set_live(state)
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

    def finish_success(self, req, local_name, photo, photos, photo_options=None):
        """Registration saved on the Pi: create the horse on the website. photo = default profile photo,
        photo_options = up to 6 whole-camera pictures (BGR) to choose from on the website. Never blocks:
        the pictures are copied here and encoded/uploaded by the background threads."""
        options = [o for o in (photo_options or []) if o is not None][:6]
        pictures = []                                   # (image, is the profile photo)
        prof = None
        if photo is not None:
            for o in options:                           # is the default photo one of the options?
                if o is photo or (o.shape == photo.shape and (o == photo).all()):
                    prof = o
                    break
        for o in options:
            pictures.append((o.copy(), o is prof))
        if photo is not None and prof is None and options:
            pictures.insert(0, (photo.copy(), True))    # its own picture, shown first
        elif pictures and photo is None:
            pictures[0] = (pictures[0][0], True)
        thumb_src = photo if photo is not None else (pictures[0][0] if pictures else None)
        self.jobs.put({"kind": "done", "id": req["id"], "name": req["name"], "local_name": local_name,
                       "age": req.get("age"), "normal_temp": req.get("normal_temp"),
                       "photo_img": None if thumb_src is None else thumb_src.copy(), "photos": photos,
                       "pictures": pictures})
        self._release()

    # ------------------------------------------------------------ profile photos
    def take_photo_request(self):
        """Main loop, every frame: a "Take profile photo" request from the website → {"id", "horse_code"} or None.
        Only scripts that call this get requests (older scripts never take them)."""
        self._photo_wanted_t = time.time()
        with self.lock:
            req, self.photo_inbox = self.photo_inbox, None
        return req

    def send_profile_photo(self, request_id, horse_code, img, error=None):
        """Answer a request (or the p key, request_id None): img = whole camera picture (BGR) → new profile photo;
        or error = why not (e.g. "Jafar is not the confirmed horse in the stall right now")."""
        if img is None or error:
            msg = error or "The Pi could not take the photo."
            print(time.strftime("%H:%M:%S"), f"Web link: no profile photo for {horse_code}: {msg}")
            if request_id is not None:
                self.photo_jobs.put({"fail": True, "request_id": request_id, "message": msg})
            return
        self.photo_jobs.put({"horse_code": horse_code, "img": img.copy(), "make_profile": True,
                             "source": "website" if request_id is not None else "pi_key",
                             "request_id": request_id, "label": f"profile photo of {horse_code}"})

    def _poll_photo_request(self):
        now_t = time.time()
        if now_t - self._photo_wanted_t > 10 or now_t < self._photo_off_until:
            return
        with self.lock:
            if self.photo_inbox is not None:
                return
        try:
            req = self.rpc("device_take_photo_request", p_device_key=self.device_key)
        except urllib.error.HTTPError as e:
            if e.code == 404:                           # 10_profile_photos.sql not run yet
                if self._photo_off_until == 0.0:
                    print("Web link: profile photos need supabase/10_profile_photos.sql (skipping them for now)")
                self._photo_off_until = now_t + 300
                return
            raise
        if req:
            with self.lock:
                self.photo_inbox = req

    def _photo_loop(self):
        while True:
            job = self.photo_jobs.get()
            delay = 5.0
            while True:
                try:
                    if job.get("fail"):
                        self.rpc("device_fail_photo_request", p_device_key=self.device_key,
                                 p_id=job["request_id"], p_message=job["message"])
                    else:
                        if "image" not in job:          # encode once, keep it for retries
                            img = job.pop("img")
                            job["image"] = to_data_url(img, PHOTO_PX, 80)
                            job["thumb"] = to_data_url(img, THUMB_PX, 75)
                            h, w = img.shape[:2]
                            sc = min(1.0, PHOTO_PX / max(h, w))
                            job["w"], job["h"] = int(w * sc), int(h * sc)
                        self.rpc("device_add_horse_photo", p_device_key=self.device_key, p_horse_code=job["horse_code"],
                                 p_image=job["image"], p_thumb=job["thumb"], p_source=job.get("source", "registration"),
                                 p_width=job["w"], p_height=job["h"], p_make_profile=bool(job.get("make_profile")),
                                 p_request_id=job.get("request_id"))
                        print(time.strftime("%H:%M:%S"), f"Web link: sent {job.get('label', 'photo')} "
                              f"({len(job['image']) // 1024} KB)")
                    break
                except urllib.error.HTTPError as e:
                    text = e.read().decode(errors="replace")
                    try:
                        sqlstate = str(json.loads(text).get("code", ""))
                    except ValueError:
                        sqlstate = ""
                    if e.code == 404 and "PGRST202" in text:   # 10_profile_photos.sql not run: the thumbnail stays
                        print("Web link: profile photos need supabase/10_profile_photos.sql - photo not sent")
                        break
                    if sqlstate == "P0002" or sqlstate[:2] in ("22", "23"):
                        print(time.strftime("%H:%M:%S"), f"Web link: website refused {job.get('label', 'photo')}: {text[:160]}")
                        if job.get("request_id") is not None and not job.get("fail"):
                            job = {"fail": True, "request_id": job["request_id"], "message": "The website refused the photo."}
                            continue
                        break
                except Exception:
                    pass
                time.sleep(delay)                       # offline: try again, slower and slower
                delay = min(60.0, delay * 2)

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
    """BGR image → JPEG 'data:image/jpeg;base64,…', longest side at most `size` px."""
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
            try:                                 # live view (the Dashboard's "In the stall now" in real time)
                link.rpc("device_live", p_device_key=link.device_key,
                         p_state={"present": False, "horses": [], "mode": "test", "time": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
                print("✓ Live view (08_live_view.sql) is installed.")
            except urllib.error.HTTPError as e8:
                print(f"✗ Live view isn't installed: run supabase/08_live_view.sql ({e8.code}).")
            try:                                 # empty batch: proves 09_pi_readings_batch.sql is installed
                link.rpc("device_submit_readings", p_device_key=link.device_key, p_readings=[])
                print("✓ Reading upload in batches (09_pi_readings_batch.sql) is installed.")
            except urllib.error.HTTPError as e9:
                print(f"✗ Batch reading upload isn't installed: run supabase/09_pi_readings_batch.sql ({e9.code}).")
                print("  Until then readings are sent one at a time with 08's device_submit_reading.")
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
