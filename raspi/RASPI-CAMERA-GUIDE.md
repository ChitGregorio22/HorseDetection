# Raspberry Pi → Website: thesisv2.py, live camera (Tailscale Funnel), readings

```
Pi Camera ─► thesisv2.py --stream 8000 ─► Tailscale Funnel ─► https://horse-cam.<tailnet>.ts.net
  (YOLO outline, name, temperature drawn on it)                         │
                              Website Dashboard (Vercel) ◄──────────────┘  address saved ONCE in Settings
thesisv2.py --web ◄──── "Register a horse" requests ───── Supabase ◄── website Register page
       ├──── progress, new horse + photo, heartbeat (air temp + humidity every 30 s) ──► Supabase ──► website
       └──── web.queue_reading(): one reading per CONFIRMED horse per minute ──► History, trend, fever alerts
             (final body temp, coat temp, air temp, humidity, fingerprint or QR plate)
```

**thesisv2.py is the final program.** `--stream` (website picture) and `--web` (website link) are **built in**:
**don't run `add_streaming.py` or `add_web_link.py` on it** (they refuse anyway). Those two patchers are only
for older scripts such as horse_monitor.py.

**Camera options aren't needed**: thesisv2.py reads them from `thermal_calib.json` (saved by `sync_camera_thermal.py`).

**thesisv2_backup.py** is the copy for testing and for calibration readings (key **k**: rectal thermometer).

**Readings**: after a horse is confirmed (fingerprint or the stall's QR plate), thesisv2.py stores a reading in
horses.db and hands it to `web_link.py` (`web.queue_reading`). That never slows the camera: a background thread sends
it with `device_submit_reading`. Unsent readings are kept in **`pending_readings.jsonl`** (next to web_link.py) and go
out when the internet is back, even after a restart. A reading retried after a network error is stored **once**.
Readings for a horse the website doesn't know (deleted there) go to `rejected_readings.jsonl` instead.
Uncertain horses are never sent.

**Body temperature is final on the Pi** (surface + offset + DHT22 correction from `compensation.json`). The website
never adds the old calibration offset to these readings (Settings shows it as *not used for Pi readings*).

**Dashboard**: camera on the left; on the right the horse in the stall, its temperature, and the **air temperature and
humidity** (DHT22, live). Below: the latest stored reading (body, coat, air, humidity, time, *via QR*), trend chart.
With **Follow the camera** ticked, the Dashboard switches to each horse as its reading arrives.

**Tailscale Funnel:** the Pi makes an *outgoing* connection to Tailscale, and Tailscale gives it a permanent `https://` address. **No pfSense, no router or port-forwarding changes, no public IP.** Free, and the address never changes.

**Only one program can use the Pi camera at a time.** Don't run thesisv2.py and thesisv2_backup.py (or camera_stream.py) together.

Files next to **thesisv2.py** on the Pi: **`web_stream.py`**, **`web_link.py`**, **`web.env`** (copied as they are).

---

## Step 0: Database (once, in Supabase → SQL Editor)
Run, in order, the ones not done yet: `03_live_camera.sql`, `04_device_status.sql`, `05_roles_and_approval.sql`,
`06_signup_role.sql`, `07_remote_registration.sql`, `08_live_view.sql`, then **`09_pi_readings.sql`** (readings
from thesisv2.py). Each is safe to run again. **Never** run 00_reset, 01_schema or 02_seed again.

## Step 1: Connect thesisv2.py to the website (once)
1. **Register the Pi as a device** in Supabase → SQL Editor (skip if you already have one):
   ```sql
   insert into public.devices (name, location)
   values ('Stall Pi', 'Vv Neri Livestock Farm – stall 1')
   returning device_key;
   ```
   Copy the `device_key`.
2. **Create `web.env`** next to thesisv2.py (this file stays on the Pi, never upload it to GitHub):
   ```bash
   nano web.env
   ```
   ```
   SUPABASE_URL=https://pjqocndvsdkpeuzjjxdz.supabase.co
   SUPABASE_KEY=sb_publishable_YOUR_KEY
   DEVICE_KEY=PASTE_DEVICE_KEY
   ```
3. **Copy `web_link.py` and `web_stream.py`** next to thesisv2.py (replace older copies), then test:
   ```bash
   python3 web_link.py --test
   ```
   You should see `✓ Connected`, `✓ Remote registration is installed` and `✓ Reading upload (09_pi_readings.sql) is installed`.
4. **Horses registered on the Pi before** (with `r`): put them on the website once:
   ```bash
   python3 web_link.py --push-existing
   ```
   Then set their age and normal temperature on the website (**Horses → Edit**).
5. **Run it** (window + website). Pick a secret stream key (letters and numbers, e.g. `HorseCam2026x`):
   ```bash
   python3 thesisv2.py --thermal --dht --id-model horse_id_mobilenetv3_farm_v2.onnx \
     --id-config horse_id_config_farm_v2.json --web --stream 8000 --stream-key HorseCam2026x
   ```
   On a phone **on the same Wi-Fi**, `http://<pi-ip>:8000` (find the IP with `hostname -I`) shows the same picture.
   On the website: **Register** → type the name → **Start registration** → turn the horse.

## QR plates (stall backup ID)
The QR holds **only the horse code** in capitals (e.g. `HTM-92578BC8`), error correction M: the smallest QR
(21 × 21 squares), so the camera reads it from farther away. Size: about **11 cm of QR per metre** between camera
and plate (25 cm ≈ 2.3 m).
- **On the Pi**, all plates at once: `python3 thesisv2.py --qr all`
- **On the website**: Register (after a registration) or **Horses → profile → Print QR plate**. Choose the size, print
  at **100% / Actual size** (not "Fit to page"). A 25 cm QR with its white border is 35.5 × 42.5 cm (A2): use
  *Save as PDF* and print it at a print shop, or pick 20 cm (A3) / 13 cm (A4).
- Hang it on the stall the horse is in, facing the camera. Move it with the horse.

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

## Step 5: Start thesisv2.py automatically on boot (no window)
For a CCTV that runs by itself, thesisv2.py runs as a service with `--no-show`. That means no window on the Pi, but the picture still goes to the website.

1. Find the two paths you need. In the folder with thesisv2.py, with your Python environment active (if you use one):
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
   Description=Horse Thermal Monitor (thesisv2.py + website)
   After=network-online.target
   Wants=network-online.target

   [Service]
   WorkingDirectory=/home/pi/horse
   ExecStart=/home/pi/horse/venv/bin/python3 thesisv2.py --thermal --dht --id-model horse_id_mobilenetv3_farm_v2.onnx --id-config horse_id_config_farm_v2.json --no-show --web --stream 8000 --stream-key HorseCam2026x
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

**Registering a horse** works from the website while the service runs (no window needed).
**Calibration readings** (`k`, rectal thermometer) use **thesisv2_backup.py** with the window. Stop the service first (only one program can use the camera):
```bash
sudo systemctl stop horse-monitor
python3 thesisv2_backup.py --thermal --dht --id-model horse_id_mobilenetv3_farm_v2.onnx --id-config horse_id_config_farm_v2.json
sudo systemctl start horse-monitor
```
After new rectal readings, run `fit_compensation.py` again: thesisv2.py picks up the new `compensation.json` on its next start.

## Step 6: Connection indicator ("Raspberry Pi: Online")
**With `--web` you can skip this step**: thesisv2.py sends the heartbeat itself (camera, thermal, DHT22, CPU temperature). The separate `heartbeat.py` service is only useful if you want "Online" while thesisv2.py is stopped. Don't run both.

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
   It ends with `✓ connected to the website`. 
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
| No new readings on the website | `python3 web_link.py --test`. If it lists readings waiting in `pending_readings.jsonl`, they are sent once thesisv2.py --web runs with internet. *Reading upload isn't installed* → run `09_pi_readings.sql`. |
| Log: *readings wait for supabase/09_pi_readings.sql* | Run `09_pi_readings.sql`. Nothing is lost: the readings wait in `pending_readings.jsonl`. |
| Log: *the website doesn't know HTM-…* | That horse was deleted on the website. Its readings stay in horses.db and `rejected_readings.jsonl`. |
| `already has the website link built in` | You ran add_web_link.py on the new thesisv2.py. Nothing was changed; it doesn't need it. |
| **Can't be shown here (http://)** | You pasted the local `http://` address. Use the `https://…ts.net` address. |
| Page says *Wrong or missing ?key=* | The key in the website address doesn't match `--stream-key`. |
| `Address already in use` (port 8000) | Something else uses port 8000, e.g. `camera_stream.py`, thesisv2_backup.py or a second thesisv2.py. Stop it: `sudo systemctl stop horse-camera` / `pkill -f camera_stream.py`. |
| Camera error *"Device or resource busy"* | Two programs are using the camera. Only thesisv2.py should run. `sudo systemctl disable --now horse-camera` if you set up camera_stream earlier. |
| Header **Raspberry Pi: Offline** | `journalctl -u horse-heartbeat -n 20`. *Unknown or inactive device* = wrong DEVICE_KEY; *cannot reach Supabase* = no internet. |
| Header **Not set up** | Run `supabase/04_device_status.sql`. |
| See thesisv2.py errors | `journalctl -u horse-monitor -n 50` |
| Register page stays on **Waiting for the Pi…** | thesisv2.py isn't running with `--web`, or `web.env` is wrong. Run `python3 web_link.py --test`. |
| Register page: "isn't installed in the database" | Run `supabase/07_remote_registration.sql`. |
| "looks like X, not saved" | The new horse's photos match an already registered horse. If it really is a different horse, press **Register anyway**. |
| Dashboard says **Not live** | The Pi isn't sending the 2-second live view. Normal for thesisv2.py if it only sends readings: the Dashboard then follows the readings and shows the DHT22 from the heartbeat. |
| Dashboard: "needs the database update 08_live_view.sql" | Run `supabase/08_live_view.sql`. |
| Dashboard: "X isn't on the website yet" | That horse was registered on the Pi only: `python3 web_link.py --push-existing`. |
| Video slow / laggy | Add `--stream-fps 4` to the service command. |

### Older scripts (horse_monitor.py)
horse_monitor.py doesn't have the website built in: `python3 add_streaming.py horse_monitor.py` and
`python3 add_web_link.py horse_monitor.py` add `--stream` and `--web` (each keeps a backup, safe to run twice).
`camera_stream.py` streams the plain camera without any monitor (`--test` for a moving test picture). Never run two camera programs at once.
