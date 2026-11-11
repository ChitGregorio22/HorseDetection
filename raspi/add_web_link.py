"""
add_web_link.py — adds --web to horse_monitor.py: register horses from the website.

Run once on the Pi, in the folder with horse_monitor.py and web_link.py:
    python3 add_web_link.py horse_monitor.py

Keeps a backup (horse_monitor.py.bak-before-web) and makes 5 small edits:
  1. new options: --web, --web-env (default web.env)
  2. end_registration(): remembers the result for the website (saved / looks like X / too few photos)
  3. a registration started from the website never waits for the y/n key (it reports "looks like X" instead)
  4. before the main loop: connects to the website and defines web_tick()
  5. every frame: web_tick() starts website requests, sends progress, handles cancel, reports the result
Running it twice is safe. Works together with add_streaming.py (run both, any order).
"""
import shutil
import sys
from pathlib import Path

path = Path(sys.argv[1] if len(sys.argv) > 1 else "horse_monitor.py")
src = path.read_text()
if "web_tick" in src:
    raise SystemExit(f"{path} already has --web. Nothing to do.")
lines = src.splitlines()


def find(text, next_starts=None):
    for i, line in enumerate(lines):
        if line.rstrip() == text and (next_starts is None or lines[i + 1].strip().startswith(next_starts)):
            return i
    raise SystemExit(f"Could not find this line in {path} (is it a different version?):\n    {text}")


# 1. options
i = find("args = ap.parse_args()")
lines[i:i] = [
    "# website: register horses from the website's Register page, heartbeat (see web_link.py)",
    'ap.add_argument("--web", action="store_true", help="take horse registrations from the website + heartbeat")',
    'ap.add_argument("--web-env", default="web.env", help="file with SUPABASE_URL, SUPABASE_KEY, DEVICE_KEY")',
]

# 2. remember the registration result for the website
i = find("    saved, other, sim = save_registration(reg_name, force or args.force)")
lines[i + 1:i + 1] = [
    "    if remote_req is not None:                       # started from the website: report it there",
    '        globals()["remote_result"] = (saved, other, sim)',
]

# 3. no y/n question for website registrations
i = find("        if args.no_show:", next_starts='say(f"Not saved: this looks like')
lines[i] = "        if args.no_show or remote_req is not None:"

# 4. connect + web_tick(), just before the main loop
i = next((k for k, l in enumerate(lines) if l.strip().startswith("# ---") and l.rstrip().endswith(" main loop")), None)
if i is None:
    raise SystemExit(f"Could not find the '# ---- main loop' line in {path}")
lines[i:i] = '''# ---------------------------------------------------------------- website link (--web)
web, remote_req, remote_result, remote_force_was = None, None, None, False
if args.web:
    from web_link import WebLink, pick_profile_crop  # noqa: E402  (web_link.py next to this script)
    web = WebLink.from_env(args.web_env, db)


def web_tick():
    """--web, once per frame: start a registration requested on the website, send its progress,
    stop it if cancelled there, and report the result (horse created on the website, or why not)."""
    global remote_req, remote_result, remote_force_was, mode
    if web is None:
        return
    for local_name, code in web.poll_results():          # website gave the new horse its ID
        db.execute("UPDATE horses SET horse_code = ? WHERE name = ?", (code, local_name))
        db.commit()
    if frame_no % 10 == 0:                                 # heartbeat details (sent every 30 s)
        air, rh = ambient()
        web.set_status(camera=True, thermal=(thermal_frame() is not None) if args.thermal else None,
                       dht=(air is not None) if args.dht else None, air_temp=air, humidity=rh,
                       cpu_temp=round(cpu_temp(), 1), registering=mode == "registering",
                       monitor=True, monitor_detail=f"YOLO {t_yolo:.0f} ms, {'horse' if present else 'no horse'}")
    if remote_req is None:
        web.want_work = mode == "recognise"
        cmd = web.take_command() if mode == "recognise" else None
        if cmd:
            remote_req, remote_result = cmd, None
            remote_force_was, args.force = args.force, bool(cmd.get("force"))
            start_registration(cmd["name"])
            web.progress(cmd["id"], {"photos": 0, "needed": args.samples, "need_views": NEED,
                                     "views": view_counts(), "missing": views_missing()},
                         f"Registering {cmd['name']}: turn the horse slowly all the way round")
        return
    rid = remote_req["id"]
    if web.cancelled(rid):                                 # cancelled on the website
        if mode == "registering":
            mode = "recognise"
            say(f"Registration of {reg_name} cancelled from the website, nothing saved")
        remote_req, args.force = None, remote_force_was
        web.finish_failed(rid, "Cancelled.", kind="cancelled")
        return
    if mode == "registering":
        n_horses = len(polys) if "polys" in globals() else None   # horses YOLO saw in the last frame
        web.progress(rid, {"photos": len(reg_embs), "needed": args.samples, "views": view_counts(),
                           "need_views": NEED, "missing": views_missing(), "note": reg_note,
                           "horses_in_view": n_horses},
                     f"Photo {len(reg_embs)}/{args.samples}" + (f" - {reg_note}" if reg_note else ""))
        return
    # the registration has ended
    if remote_result is None:
        web.finish_failed(rid, "Registration was stopped on the Pi before it finished. Nothing saved.")
    else:
        saved, other, sim = remote_result
        if saved:
            web.finish_success(remote_req, reg_name, pick_profile_crop(reg_crops, reg_info), len(reg_embs))
        elif other:
            web.finish_failed(rid, f"Not saved: this horse looks like {other} (similarity {sim:.2f}). "
                                   f"If it really is a different horse, press 'Register anyway'.")
        else:
            web.finish_failed(rid, f"Not saved: only {len(reg_embs)} usable photos. Keep one whole horse in view "
                                   f"and turn it slowly, then try again.")
    if mode == "confirm":
        mode = "recognise"
    remote_req, remote_result, args.force = None, None, remote_force_was

'''.splitlines()

# 5. call it every frame, right after the camera picture is taken
i = find("    t_cam = (time.time() - t0) * 1000")
lines[i + 1:i + 1] = ["    web_tick()"]

backup = path.with_name(path.name + ".bak-before-web")
shutil.copy2(path, backup)
path.write_text("\n".join(lines) + "\n")
compile(path.read_text(), str(path), "exec")
print(f"Done: {path} now has --web (backup: {backup.name})")
print("Next: create web.env (see web_link.py), then:")
print("  python3 web_link.py --test")
print("  python3 horse_monitor.py --thermal --dht --web --stream 8000 --stream-key YourKey")
