# Live Camera from the Raspberry Pi → Website Dashboard (Tailscale Funnel)

```
Pi camera ──► camera_stream.py (port 8000) ──► Tailscale Funnel ──► https://horse-cam.<your-tailnet>.ts.net
   (starts on boot)                            (starts on boot)                       │
                                                       Website Dashboard (Vercel) ◄───┘  saved ONCE in Settings
```

**How it works:** the Pi makes an **outgoing** connection to Tailscale. Tailscale gives it a permanent public `https://` address and forwards visitors through that connection to the Pi's camera program. No one connects *into* your network directly, so:
- ❌ **No pfSense, no router changes, no port forwarding, no public IP needed.** It works behind any home/school Wi-Fi, mobile hotspot, or ISP that blocks incoming connections (CGNAT).
- ✅ The address stays the same after reboots, so you paste it in Settings **once**.
- ✅ Free (Tailscale Personal plan). The only requirement is that the Pi has internet.

---

## Step 0: Database update (once)
In Supabase, open **SQL Editor → New query**. Paste the contents of `supabase/03_live_camera.sql` and click **Run**.

## Step 1: Copy the program and install requirements (on the Pi)
```bash
mkdir -p /home/pi/horse
# copy camera_stream.py into /home/pi/horse (USB stick, or from your Mac:)
#   scp raspi/camera_stream.py pi@raspberrypi.local:/home/pi/horse/
sudo apt update
sudo apt install -y python3-flask python3-opencv python3-picamera2
```
> If your Pi user isn't `pi`, replace `/home/pi` and `User=pi` below with your username (check with `whoami`).

## Step 2: Test the camera (on the Pi)
Pick your own secret key in place of `MySecretKey123`.
```bash
python3 /home/pi/horse/camera_stream.py --key MySecretKey123          # Pi Camera Module
python3 /home/pi/horse/camera_stream.py --usb --key MySecretKey123    # USB / USB thermal camera / USB CCTV
python3 /home/pi/horse/camera_stream.py --test --key MySecretKey123   # no camera yet
```
On a laptop **on the same Wi-Fi**, open `http://raspberrypi.local:8000`. If you see video, it works. Press **Ctrl + C** to stop it.

## Step 3: Make the camera start automatically on boot
```bash
sudo nano /etc/systemd/system/horse-camera.service
```
Paste this. Change the key, and add `--usb` after `camera_stream.py` if you use a USB camera:
```ini
[Unit]
Description=Horse Thermal Monitor camera stream
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /home/pi/horse/camera_stream.py --key MySecretKey123
Restart=always
RestartSec=5
User=pi

[Install]
WantedBy=multi-user.target
```
Save (**Ctrl + O**, Enter, **Ctrl + X**), then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now horse-camera
systemctl status horse-camera      # should say "active (running)"
```

## Step 4: Install Tailscale and log in (on the Pi)
1. Create a free account at **tailscale.com** (sign in with Google/GitHub). Use a shared group account, so it doesn't depend on one member.
2. On the Pi:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --hostname=horse-cam
   ```
3. It prints a login link. Open it on any device, log in, and approve the Pi.

Tailscale is installed as a system service, so it **starts on boot automatically**.

## Step 5: Turn on Funnel (public https address)
1. On **login.tailscale.com/admin** → **DNS** page: make sure **MagicDNS** and **HTTPS Certificates** are on, and turn on **Funnel**. On new accounts the first two are usually already on.
2. On the Pi:
   ```bash
   sudo tailscale funnel --bg 8000
   ```
   - `--bg` keeps it running in the background, and it **comes back by itself after a reboot**.
   - If it prints a link saying Funnel isn't enabled yet, open the link, click **Enable**, then run the command again.
3. It prints your permanent address, like:
   ```
   https://horse-cam.tail1a2b3c.ts.net/
   ```
   Check anytime with `tailscale funnel status`.

## Step 6: Put the address in the website (once)
1. Log in as **admin** → **Settings** → **Live Camera**.
2. Paste your address **+ `stream.mjpg?key=` + your key**:
   ```
   https://horse-cam.tail1a2b3c.ts.net/stream.mjpg?key=MySecretKey123
   ```
3. Click **Save All Settings** → open **Dashboard** → red **LIVE** badge. ✅

## Step 7: Test that it's really automatic
```bash
sudo reboot
```
Wait 1–2 minutes and open the Dashboard. The camera should come back **LIVE** by itself, without opening the Pi. The Dashboard also retries every 20 seconds while the Pi is starting up.

---

## Connection indicator: "Raspberry Pi: Online" on the website
Every 30 seconds the Pi checks in. The website header shows **🟢 Raspberry Pi: Online**, or **🔴 Offline** if there's been no check-in for 90 seconds. **Settings → Raspberry Pi Connection** shows details: camera, thermal sensor, DHT22, detection program, CPU temperature, uptime and IP.

### A. Database (once)
In Supabase **SQL Editor**, run `supabase/04_device_status.sql`.

### B. Register the Pi as a device (once)
If you deleted the demo device, add yours. In SQL Editor, run:
```sql
insert into public.devices (name, location)
values ('Stall Pi', 'Vv Neri Livestock Farm – stall 1')
returning device_key;
```
Copy the `device_key` it shows. That's the Pi's password for talking to the website.

### C. Test from the Pi
Copy `heartbeat.py` to `/home/pi/horse/`, then (with your values):
```bash
python3 /home/pi/horse/heartbeat.py --once \
  --url https://pjqocndvsdkpeuzjjxdz.supabase.co \
  --key sb_publishable_YOUR_KEY \
  --device-key PASTE_DEVICE_KEY
```
It prints the health report, then `✓ connected to the website`. Refresh the website: the header shows **Raspberry Pi: Online**. ✅

### D. Make it automatic (starts on boot)
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
journalctl -u horse-heartbeat -n 20      # should show "✓ connected to the website"
```

**Before proceeding with any test:** open the website and check that the header says **Raspberry Pi: Online**. If it says Offline, the Pi has no internet, is off, or the service stopped.

> Later, inside `horse_monitor.py`, you can report the real sensor state:
> `from heartbeat import Heartbeat` → `hb = Heartbeat(URL, KEY, DEVICE_KEY)` → `hb.update(thermal=True, dht=True, air_temp=27.4, humidity=81)`.
> If you do that, stop the separate `horse-heartbeat` service so only one heartbeat runs.

---

## Troubleshooting
| Dashboard shows | What to do |
|---|---|
| **Camera not set up yet** | No address saved. Do Step 6. |
| **Camera offline** | On the Pi: `systemctl status horse-camera` (camera program) and `tailscale funnel status` (Funnel). Check that the Pi has internet. |
| Offline only after a reboot | Run `sudo systemctl enable horse-camera`, and run `sudo tailscale funnel --bg 8000` again (with `--bg`). |
| **Can't be shown here (http://)** | You pasted the local `http://` address. Use the `https://…ts.net` Funnel address. |
| Video slow / laggy | Edit the service: add `--width 480 --height 360 --quality 60 --fps 10`, then `sudo systemctl restart horse-camera`. |
| `No camera found at /dev/video0` | `ls /dev/video*` to list cameras, then add `--device 1` (etc.) to the service. |
| See program errors | `journalctl -u horse-camera -n 50` |
| Page says *Wrong or missing ?key=* | The key in the website address doesn't match `--key` in the service. |
| Header says **Raspberry Pi: Not set up** | Run `supabase/04_device_status.sql`. |
| Header says **Offline** | On the Pi: `journalctl -u horse-heartbeat -n 20`. *Unknown or inactive device* means the DEVICE_KEY is wrong; *cannot reach Supabase* means no internet. |

### Alternative: Cloudflare Quick Tunnel (for quick testing only)
`cloudflared tunnel --url http://localhost:8000` gives a free `https://….trycloudflare.com` address with no account. The address **changes every restart**, so it doesn't suit the automatic setup.
