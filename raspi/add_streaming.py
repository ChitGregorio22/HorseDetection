"""
add_streaming.py — adds website live streaming (--stream) to horse_monitor.py.

Run once on the Pi, in the folder with horse_monitor.py and web_stream.py:
    python3 add_streaming.py horse_monitor.py

It keeps a backup (horse_monitor.py.bak-before-stream) and makes 4 small edits:
  1. new options: --stream PORT, --stream-key KEY, --stream-fps N
  2. starts the web stream (web_stream.py) before the main loop
  3. with --no-show + --stream it still draws the picture (for the website) but opens no window
  4. sends each finished picture (outlines, names, temperatures) to the stream
Running it twice is safe (it sees it's already done).
"""
import shutil
import sys
from pathlib import Path

path = Path(sys.argv[1] if len(sys.argv) > 1 else "horse_monitor.py")
src = path.read_text()
if "web_stream" in src:
    raise SystemExit(f"{path} already has --stream. Nothing to do.")

lines = src.splitlines()


def find(text, start=0, next_line=None):
    """Index of the first line whose content (ignoring trailing spaces) equals text."""
    for i in range(start, len(lines)):
        if lines[i].rstrip() == text and (next_line is None or lines[i + 1].strip().startswith(next_line)):
            return i
    raise SystemExit(f"Could not find this line in {path} (is it a different version?):\n    {text}")


# 1. options, just before args = ap.parse_args()
i = find("args = ap.parse_args()")
lines[i:i] = [
    "# website live stream (Tailscale Funnel publishes this port as https://...ts.net)",
    'ap.add_argument("--stream", type=int, default=0, metavar="PORT",',
    '                help="serve the monitor picture on this port for the website (e.g. 8000; 0 = off)")',
    'ap.add_argument("--stream-key", default="", help="secret the website address must end with: ?key=...")',
    'ap.add_argument("--stream-fps", type=float, default=8.0, help="max pictures per second sent to the website")',
]

# 2. start the stream server just before the main loop
i = next((k for k, l in enumerate(lines) if l.strip().startswith("# ---") and l.rstrip().endswith(" main loop")), None)
if i is None:
    raise SystemExit(f"Could not find the '# ---- main loop' line in {path} (is it a different version?)")
lines[i:i] = [
    "streamer = None",
    "if args.stream:",
    "    from web_stream import MjpegServer  # noqa: E402  (web_stream.py next to this script)",
    "    streamer = MjpegServer(args.stream, key=args.stream_key, fps=args.stream_fps)",
    "",
]

# 3. headless (--no-show) keeps drawing when streaming
i = find("    if args.no_show:", next_line="if frame_no % 10 == 0:")
lines[i] = "    if args.no_show and streamer is None:"

# 4. send the finished picture to the website; no window with --no-show
i = find('    cv2.imshow("Horse monitor", view)')
lines[i:i] = [
    "    if streamer is not None:",
    "        streamer.publish(view)",
    "    if args.no_show:",
    "        continue",
]

backup = path.with_name(path.name + ".bak-before-stream")
shutil.copy2(path, backup)
path.write_text("\n".join(lines) + "\n")
compile(path.read_text(), str(path), "exec")  # make sure the result is valid Python
print(f"Done: {path} now has --stream (backup: {backup.name})")
print("Try it:  python3 horse_monitor.py --thermal --dht --stream 8000 --stream-key MySecretKey123")
