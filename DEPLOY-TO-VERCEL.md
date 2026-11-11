# Horse Thermal Monitor: Publish on Vercel with the Supabase Database

This is your Figma Make design (same look, same screens) connected to your Supabase database.
Horses, photos, temperature readings, alerts and settings are saved online, so every phone and laptop sees the same data.

## What's in this folder

| File / folder | What it does |
|---|---|
| `index.html` | The website's single page (title, 🐎 icon). |
| `src/main.tsx` | Starts the app and loads the CSS. |
| `src/app/App.tsx` | Header, navigation, login check, loads horses from the database, live updates. |
| `src/app/lib/supabase.ts` | Connection to Supabase (reads the URL + key from environment variables). |
| `src/app/lib/api.ts` | Every database action: horses, readings, alerts, settings, photo upload. |
| `src/app/components/` | Screens: Login (new), Dashboard, History, Alerts, Horses, Register, Settings. |
| `src/styles/` | All CSS: Poppins font, Tailwind, green farm theme. |
| `supabase/` | The SQL you already ran (01 schema, 02 demo data, 00 reset). |
| `device/send_reading.py` | Script for the thermal camera / Raspberry Pi to send readings. |
| `raspi/` | Live camera program for the Raspberry Pi + step-by-step guide. |
| `package.json`, `vite.config.ts`, `vercel.json` | Build settings for Vercel. |

---

## Step 1: Put the code on GitHub
**If this is your first upload:** create a new repository on github.com. Unzip `horse-thesis-vercel.zip`, open the `horse-thesis-vercel` folder, select everything inside it (Cmd + A), and **drag** it onto GitHub's upload page. Then click **Commit changes**. You can also use GitHub Desktop.

**If you already uploaded the earlier version:** open your repository → **Add file → Upload files**. Drag the same contents of the folder in again. GitHub replaces the old files with the new ones. Click **Commit changes**.

> Check: `package.json` must be on the first page of the repository, and `src` must contain `app`, `styles`, `imports`, `main.tsx`.

## Step 2: Copy your Supabase keys
In Supabase, click **Connect** (top bar) or go to **Project Settings → API**. Copy:
- **Project URL**, which looks like `https://pjqocndvsdkpeuzjjxdz.supabase.co`
- **anon public** key (also called the *publishable* key)

⚠️ Never use the `service_role` / secret key in the website.

## Step 3: Add the keys to Vercel
1. Open your project on vercel.com → **Settings → Environment Variables**.
2. Add two variables:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon key |

3. Click **Save**.
4. Go to **Deployments**, click **⋯** on the latest deployment, then **Redeploy**. Environment variables only take effect after a redeploy.

> If you haven't created the Vercel project yet: **Add New → Project → Import** your repository. Before clicking Deploy, open **Environment Variables** on that screen, add the two keys there, then click **Deploy**.

If the site says **"Database not connected yet"**, the keys are missing or misspelled. Check Step 3.

## Step 4: Supabase login settings (once)
In Supabase → **Authentication**:
1. **Sign In / Providers → Email**: turn **Confirm email** off, then **Save**. This lets new accounts log in immediately.
2. **URL Configuration → Site URL**: paste your Vercel link (e.g. `https://horse-thermal-monitor.vercel.app`), then **Save**.

## Step 5: Create your account and make yourself admin
1. Open your Vercel link → **No account yet? Sign up** → create your account.
2. In Supabase → **SQL Editor**, run this with your email:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
3. On the website, **Sign out**, then sign in again. The header now shows **Admin**.

Other group members can sign up too. They start as **caretaker** (can register horses and handle alerts). Change roles with the same SQL using `'caretaker'`, `'veterinarian'`, `'owner'` or `'admin'`.

## Step 6: Try it
- **Horses** shows the demo horses (Thunder, Lightning, Storm, Blaze). Thunder has a fever.
- **Alerts** shows Thunder's fever alert. Click **Acknowledge**, then **Mark Resolved**.
- **Register** a horse with the camera. Its QR code holds its ID (e.g. `HTM-D8072728`).
- **Send a live reading**. In `device/send_reading.py`, fill in your URL + anon key, then run:
  ```bash
  pip install requests
  python device/send_reading.py --simulate --fever --horse HTM-THUNDER1
  ```
  The Dashboard updates by itself, and at 38.0 °C or higher a fever alert appears on Alerts.

## Step 7: Switch to your real horses
When you're done testing, run this in the Supabase SQL Editor to remove the demo data:
```sql
delete from public.horses
where horse_code in ('HTM-THUNDER1','HTM-LIGHTNG1','HTM-STORM001','HTM-BLAZE001');
delete from public.devices where device_key = 'demo-device-key-change-me';
```
Then register your real horses on the website. For your real camera, go to **Table Editor → devices → Insert row** and enter just a name. Copy the generated `device_key` into `send_reading.py`.

---

## Live camera from the Raspberry Pi (Dashboard)
The Dashboard's main panel shows the live video from your Raspberry Pi.
1. In Supabase → **SQL Editor**, run `supabase/03_live_camera.sql` once.
2. Upload the updated files to GitHub (Vercel rebuilds automatically).
3. On the Pi, follow **`raspi/RASPI-CAMERA-GUIDE.md`**: the camera program and Tailscale Funnel both start automatically on boot.
4. On the website (as admin): **Settings → Live Camera**, paste `https://horse-cam.<your-tailnet>.ts.net/stream.mjpg?key=YOURKEY` (once, it never changes), and click **Save All Settings**.

## Raspberry Pi connection indicator
The header shows **Raspberry Pi: Online / Offline** on every page, and **Settings → Raspberry Pi Connection** shows camera, thermal sensor, DHT22 and CPU temperature.
1. In Supabase → **SQL Editor**, run `supabase/04_device_status.sql` once.
2. Upload the updated files to GitHub.
3. On the Pi, set up `raspi/heartbeat.py` (see `raspi/RASPI-CAMERA-GUIDE.md` → *Connection indicator*).

---

## Troubleshooting
| Problem | Fix |
|---|---|
| "Database not connected yet" | Add the two environment variables in Vercel, then **Redeploy** (Step 3). |
| "Invalid login credentials" | Wrong password, or the account was never created. Sign up first. |
| "Email not confirmed" | Turn off **Confirm email** (Step 4), or click the link in the email. |
| "Could not load data… permission denied" | Run `01_schema.sql` in Supabase if you haven't. |
| Settings won't save | Only an **admin** can change settings (Step 5). |
| Photo upload fails | Your account must be admin or caretaker. |
| Camera won't open | Allow camera access in the browser. It only works on the `https://` Vercel link. |
| Build fails "ERESOLVE" | Add a file named `.npmrc` to the repository containing `legacy-peer-deps=true`. |
| Site stopped working after a week | Free Supabase projects pause when unused. Open the Supabase dashboard and click **Restore**. Check this before your defense. |
