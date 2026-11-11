# Raspberry Pi → Website: live camera (Tailscale Funnel) + connection indicator

```
Pi Camera ─► horse_monitor.py --stream 8000 ─► Tailscale Funnel ─► https://horse-cam.<tailnet>.ts.net
  (YOLO outline, name, temperature drawn on it)                               │
                                    Website Dashboard (Vercel) ◄──────────────┘  address saved ONCE in Settings
heartbeat.py ─────────────────────────────────────────────────► Supabase ─► header "Raspberry Pi: Online"
```

**Only one program can use the Pi camera at a time.** `horse_monitor.py` already uses it, so the website shows **horse_monitor's own picture** (outline, horse name, temperature). You don't run `camera_stream.py` at the same time. That one is only for testing without horse_monitor.

**Tailscale Funnel:** the Pi makes an *outgoing* connection to Tailscale, and Tailscale gives it a permanent `https://` address. **No pfSense, no router or port-forwarding changes, no public IP.** It works behind any Wi-Fi or mobile hotspot. Free, and the address never changes.

Files used on the Pi (all in this `raspi/` folder): `web_stream.py`, `add_streaming.py`, `heartbeat.py`, and `camera_stream.py` (testing only).

---

## Step 0: Database (once, in Supabase → SQL Editor)
Run `supabase/03_live_camera.sql`, then `04_device_status.sql`, if you haven't already.

## Step 1: Add live streaming to horse_monitor.py (once)
1. Copy **`web_stream.py`** and **`add_streaming.py`** into the **same folder as `horse_monitor.py`** on the Pi.
2. In that folder:
   ```bash
   python3 add_streaming.py horse_monitor.py
   ```
   It prints `Done: horse_monitor.py now has --stream` and keeps a backup (`horse_monitor.py.bak-before-stream`).
3. Pick a secret stream key (letters and numbers, e.g. `HorseCam2026x`) and test it **with the window**:
   ```bash
   python3 horse_monitor.py --thermal --dht --stream 8000 --stream-key HorseCam2026x
   ```
4. On a phone or laptop **on the same Wi-Fi**, open `http://<pi-ip>:8000` (find the IP with `hostname -I`). You should see the same picture as the monitor window, outlines and names included. ✅

All the old options and hotkeys still work. `--stream` only adds the website picture. The picture updates at the speed horse_monitor runs (about 2 per second with YOLO), and it's exactly what the system sees.

## Step 2: Install Tailscale on the Pi (once)
1. Create a free account at **tailscale.com**, ideally with a shared group email so it doesn't depend on one member.
2. On the Pi:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --hostname=horse-cam
   ```
3. It prints a link. Open it on any device, log in to the account, and approve the Pi.
4. Check it worked: `tailscale status` lists `horse-cam`.

Tailscale is now a system service and **starts by itself on every boot**.

## Step 3: Turn on Funnel (public https address)
1. On **login.tailscale.com/admin → DNS**: make sure **MagicDNS** and **HTTPS Certificates** are on.
2. On the Pi:
   ```bash
   sudo tailscale funnel --bg 8000
   ```
   - If it prints a link saying Funnel isn't enabled for your tailnet, open it, click **Enable**, and run the command again.
   - `--bg` keeps it running in the background and it **comes back by itself after a reboot**.
3. It prints your permanent address, e.g. `https://horse-cam.tail1a2b3c.ts.net/`. Check anytime with:
   ```bash
   tailscale funnel status
   ```
4. Test from your phone **on mobile data** (not the farm Wi-Fi): open `https://horse-cam.tail1a2b3c.ts.net/`. You should see the live picture.

## Step 4: Put the address in the website (once)
1. Log in as **owner or admin** → **Settings** → **Live Camera**.
2. Paste the address **+ `stream.mjpg?key=` + your key**:
   ```
   https://horse-cam.tail1a2b3c.ts.net/stream.mjpg?key=HorseCam2026x
   ```
3. **Save All Settings** → **Dashboard** → red **LIVE** badge. ✅

## Step 5: Start horse_monitor automatically on boot (no window)
For a CCTV that runs by itself, horse_monitor runs as a service with `--no-show`. That means no window on the Pi, but the picture still goes to the website.

1. Find the two paths you need. In the folder with horse_monitor.py, with your Python environment active (if you use one):
   ```bash
   pwd            # e.g. /home/pi/horse         → WorkingDirectory
   which python3  # e.g. /home/pi/horse/venv/bin/python3 → first part of ExecStart
   whoami         # e.g. pi                     → User
   ```
2. Create the service:
   ```bash
   sudo nano /etc/systemd/system/horse-monitor.service
   ```
   Paste, replacing the paths, user and key with yours:
   ```ini
   [Unit]
   Description=Horse Thermal Monitor (detection + website stream)
   After=network-online.target
   Wants=network-online.target

   [Service]
   WorkingDirectory=/home/pi/horse
   ExecStart=/home/pi/horse/venv/bin/python3 horse_monitor.py --thermal --dht --no-show --stream 8000 --stream-key HorseCam2026x
   Restart=always
   RestartSec=10
   User=pi

   [Install]
   WantedBy=multi-user.target
   ```
   Save (**Ctrl + O**, Enter, **Ctrl + X**).
3. Turn it on:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now horse-monitor
   journalctl -u horse-monitor -f        # live log (Ctrl + C to stop watching)
   ```

**Registering a horse or taking calibration readings** (`r`, `a`, `k` need the window): stop the service, run it by hand with the window, then start the service again:
```bash
sudo systemctl stop horse-monitor
python3 horse_monitor.py --thermal --dht --stream 8000 --stream-key HorseCam2026x   # window + website
sudo systemctl start horse-monitor
```

## Step 6: Connection indicator ("Raspberry Pi: Online")
1. Register the Pi as a device (once). In Supabase **SQL Editor**:
   ```sql
   insert into public.devices (name, location)
   values ('Stall Pi', 'Vv Neri Livestock Farm – stall 1')
   returning device_key;
   ```
   Copy the `device_key` it shows.
2. Copy **`heartbeat.py`** to the Pi (same folder) and test:
   ```bash
   python3 heartbeat.py --once --url https://pjqocndvsdkpeuzjjxdz.supabase.co \
     --key sb_publishable_YOUR_KEY --device-key PASTE_DEVICE_KEY
   ```
   It ends with `✓ connected to the website`. The report shows `"camera": true` while horse_monitor is streaming, and `"monitor": true` while horse_monitor.py runs.
3. Make it automatic:
   ```bash
   sudo nano /etc/systemd/system/horse-heartbeat.service
   ```
   ```ini
   [Unit]
   Description=Horse Thermal Monitor heartbeat
   After=network-online.target
   Wants=network-online.target

   [Service]
   Environment=SUPABASE_URL=https://pjqocndvsdkpeuzjjxdz.supabase.co
   Environment=SUPABASE_KEY=sb_publishable_YOUR_KEY
   Environment=DEVICE_KEY=PASTE_DEVICE_KEY
   ExecStart=/usr/bin/python3 /home/pi/horse/heartbeat.py
   Restart=always
   RestartSec=10
   User=pi

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now horse-heartbeat
   ```

## Step 7: Test that it's really automatic
```bash
sudo reboot
```
Wait 1–2 minutes (YOLO takes a moment to load), then open the website. The header should show **Raspberry Pi: Online** and the Dashboard camera **LIVE**, without touching the Pi.

---

## Troubleshooting
| What you see | What to do |
|---|---|
| Dashboard: **Camera not set up yet** | No address saved. Do Step 4. |
| Dashboard: **Camera offline** | On the Pi: `systemctl status horse-monitor` (running?) and `tailscale funnel status` (Funnel on?). Then open `http://<pi-ip>:8000` on the farm Wi-Fi. |
| `Could not find this line` from add_streaming.py | Your horse_monitor.py is a different version. Send the error to Claude. |
| **Can't be shown here (http://)** | You pasted the local `http://` address. Use the `https://…ts.net` address. |
| Page says *Wrong or missing ?key=* | The key in the website address doesn't match `--stream-key`. |
| `Address already in use` (port 8000) | Something else uses port 8000, e.g. `camera_stream.py` or a second horse_monitor. Stop it: `sudo systemctl stop horse-camera` / `pkill -f camera_stream.py`. |
| Camera error *"Device or resource busy"* | Two programs are using the camera. Only horse_monitor should run. `sudo systemctl disable --now horse-camera` if you set up camera_stream earlier. |
| Header **Raspberry Pi: Offline** | `journalctl -u horse-heartbeat -n 20`. *Unknown or inactive device* = wrong DEVICE_KEY; *cannot reach Supabase* = no internet. |
| Header **Not set up** | Run `supabase/04_device_status.sql`. |
| See horse_monitor errors | `journalctl -u horse-monitor -n 50` |
| Video slow / laggy | Add `--stream-fps 4` to the service command. |

### Testing without horse_monitor (optional)
`camera_stream.py` streams the plain camera on port 8000 (`python3 camera_stream.py --key HorseCam2026x`, or `--test` for a moving test picture). **Never run it at the same time as horse_monitor.py.**
