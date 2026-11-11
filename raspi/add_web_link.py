"""
add_web_link.py - adds --web to thesisv2.py / horse_monitor.py: the website link.

Run on the Pi, in the folder with the script and web_link.py:
    python3 add_web_link.py thesisv2.py

With --web the script registers horses requested on the website, tells the Dashboard which horse
the camera sees right now (name, temperature, air temperature, humidity), uploads one reading per
identified horse per minute, and sends the heartbeat. All of that lives in web_link.py; the script
only gets a one-line web_tick() call per frame, so a newer web_link.py never needs a new patch.

Keeps a backup (<script>.bak-before-web) and makes 5 small edits:
  1. new options: --web, --web-env (default web.env)
  2. end_registration(): remembers the result for the website (saved / looks like X / too few photos)
  3. a registration started from the website never waits for the y/n key
  4. before the main loop: connects to the website, defines web_tick()
  5. every frame: web_tick()
Running it twice is safe. A script patched by the OLD add_web_link.py is upgraded automatically.
Works together with add_streaming.py (run both, any order).
"""
import shutil
import sys
from pathlib import Path

path = Path(sys.argv[1] if len(sys.argv) > 1 else "horse_monitor.py")
src = path.read_text()
NEW_BLOCK = '''# ---------------------------------------------------------------- website link (--web)
web, remote_req, remote_result, remote_force_was = None, None, None, False
if args.web:
    from web_link import WebLink  # noqa: E402  (web_link.py next to this script)
    web = WebLink.from_env(args.web_env, db)


def web_tick():
    """--web, once per frame: registrations from the website, live view for the Dashboard,
    per-minute readings and heartbeat. All the work is in web_link.py (WebLink.tick)."""
    if web is not None:
        web.tick(globals())

'''.splitlines()

if "queue_reading" in src or ("add_argument(\"--web\"" in src and "website link (--web)" not in src):
    raise SystemExit(f"{path} already has the website link built in (new thesisv2.py). Don't patch it: "
                     f"just keep web_link.py, web_stream.py and web.env next to it.")
if "web.tick(globals())" in src:
    raise SystemExit(f"{path} already has the newest --web. Nothing to do.")
lines = src.splitlines()

if "web_tick" in src:                       # patched by the old add_web_link.py: swap the big block
    a = next((k for k, l in enumerate(lines) if l.startswith("# ---") and "website link (--web)" in l), None)
    b = None if a is None else next((k for k in range(a + 1, len(lines))
                                     if lines[k].strip().startswith("# ---") and lines[k].rstrip().endswith(" main loop")), None)
    if a is None or b is None:
        raise SystemExit(f"{path} has an old --web I can't find the edges of. Restore {path.name}.bak-before-web "
                         f"and run this again.")
    lines[a:b] = NEW_BLOCK
    backup = path.with_name(path.name + ".bak-before-web-v2")
    shutil.copy2(path, backup)
    path.write_text("\n".join(lines) + "\n")
    compile(path.read_text(), str(path), "exec")
    print(f"Upgraded: {path} now sends the live view + readings to the website (backup: {backup.name})")
    raise SystemExit(0)


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
lines[i:i] = NEW_BLOCK

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
print(f"  python3 {path.name} --thermal --dht --web --stream 8000 --stream-key YourKey   (plus your usual options)")
