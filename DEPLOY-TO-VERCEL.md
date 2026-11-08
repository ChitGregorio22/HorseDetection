# Publish Horse Thermal Monitor on Vercel

This folder is your Figma Make design turned into a complete website project. The design, CSS, and features are unchanged.

## What's inside

| File / folder | What it does |
|---|---|
| `index.html` | The single HTML page. It loads the app and sets the tab title and 🐎 icon. |
| `src/main.tsx` | Starts the app and loads the CSS. |
| `src/app/App.tsx` | Header, navigation tabs, the horse list (saved in the browser), and the 3-minute temperature update. |
| `src/app/components/` | The screens: Dashboard, History, Alerts, Horses, Register (live camera + QR), Settings. |
| `src/app/components/ui/` | Ready-made UI parts from Figma Make (buttons, dialogs, etc.). |
| `src/styles/` | All the CSS: Poppins font, Tailwind, and your green farm theme colors (`theme.css`). |
| `package.json` | List of libraries the app needs (React, Tailwind, Recharts, QR code, icons…). |
| `vite.config.ts` | Build settings (Vite + React + Tailwind). |
| `vercel.json` | Tells Vercel how to build and serve the site. |
| `.npmrc` | Makes the library install work smoothly on Vercel. |

**How it works:**
- Registered horses are saved in the **browser's local storage**, the same as in Figma Make.
- The temperature updates every **3 minutes**.
- The Register screen uses the device's **camera**. Vercel serves the site over HTTPS, which is required for camera access, so it works on phones and laptops.

---

## Option A: GitHub + Vercel (recommended, no coding tools needed)

Every time you update the code on GitHub, Vercel republishes the site automatically.

### 1. Put the project on GitHub
1. Go to **github.com** and sign in (or create a free account).
2. Click **+** (top right) → **New repository**.
3. Name: `horse-thermal-monitor`. Leave everything else as is. Click **Create repository**.
4. On the next page, click the link **"uploading an existing file"**.
5. Unzip `horse-thesis-vercel.zip` on your computer. Open the `horse-thesis-vercel` folder, select **everything inside it** (Cmd + A), and drag it into the GitHub upload box.
   - Drag the files *inside* the folder, not the folder itself, so `package.json` is at the top level.
   - Don't worry if hidden files like `.npmrc` and `.gitignore` don't show in Finder. The site builds without them.
6. Wait for the upload to finish, then click **Commit changes**.

### 2. Publish with Vercel
1. Go to **vercel.com** → **Sign Up** → **Continue with GitHub**.
2. Click **Add New… → Project**.
3. Find `horse-thermal-monitor` and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions** and allow access to that repository.
4. Vercel detects **Vite** automatically. Don't change anything. Click **Deploy**.
5. After about 1 minute you get a link like `https://horse-thermal-monitor.vercel.app`. 🎉

### 3. Make changes later
Edit a file on GitHub (click the file → pencil icon → **Commit changes**). Vercel rebuilds and updates the site in about a minute.

---

## Option B: Vercel CLI from your Mac (if you have Node.js)

Open Terminal in the unzipped folder, then run:
```bash
npm install
npm run dev        # preview at http://localhost:5173
npx vercel         # log in when the browser opens, press Enter to accept the defaults
npx vercel --prod  # publish the final version
```

---

## Troubleshooting

- **Build fails with "ERESOLVE could not resolve"**: the `.npmrc` file didn't upload. In GitHub, click **Add file → Create new file**, name it `.npmrc`, type `legacy-peer-deps=true`, then **Commit**.
- **Blank page / 404**: `package.json` must be at the top level of the repository, not inside a subfolder. If it's in a folder, open Vercel → **Settings → General → Root Directory** and choose that folder.
- **Camera doesn't open**: the browser must be allowed to use the camera (tap **Allow**). It works on the `https://…vercel.app` link but not on plain `http://`.
- **Horses disappear on another phone or laptop**: expected for now. Horses are saved only in the browser where they were registered. Connecting the Supabase database fixes this, so every device shares the same horses and readings.
