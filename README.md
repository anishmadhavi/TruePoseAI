# TruePose AI

AI fashion photoshoot SaaS — generate realistic catalog images and short videos
of garments on real models in real locations.

- **Frontend:** static site on **Cloudflare Pages** (`/public`)
- **Backend:** **Cloudflare Worker** (`/worker`) — holds the Gemini key, deducts
  credits, calls Google, stores results in **R2**
- **Database + Auth:** **Supabase** (`/supabase/schema.sql`)
- **Engines:** Gemini Flash (images + base models), Veo Lite (video, no audio)

**Credits:** 1 credit = ₹20 · 1 image = 1 credit · 1 model = 1 credit · 1 video = 2 credits.

---

## Security model (read this first)

- **No secret is ever in this repo or in the browser.** The Gemini key and the
  Supabase service-role key live only as **Worker secrets**.
- The browser only ever gets the **Supabase anon key** (safe by design; Row
  Level Security protects data) and the **Worker URL** — both in
  `public/js/config.js`.
- All credit changes happen inside the Worker via atomic Postgres functions, so
  a user cannot forge credits.

---

## One-time setup

### 1. Supabase

1. Create a project at supabase.com.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, Run.
3. **Authentication → Providers → Email:** enable Email. For fastest launch you
   may turn **off** "Confirm email" (users can log in immediately; you still
   gate them with manual approval below).
4. Grab these from **Project Settings → API**:
   - Project URL  → `SUPABASE_URL`
   - `anon` public key → goes in `public/js/config.js`
   - `service_role` key → Worker secret `SUPABASE_SERVICE_ROLE_KEY`
   - **Project Settings → API → JWT Settings → JWT Secret** → Worker secret
     `SUPABASE_JWT_SECRET`

### 2. Cloudflare R2

1. **R2 → Create bucket** named `truepose-assets` (matches `wrangler.toml`).

### 3. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login

# set secrets (you'll be prompted to paste each value)
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPABASE_JWT_SECRET

npx wrangler deploy
```

Copy the deployed URL (e.g. `https://truepose-ai-api.<you>.workers.dev`).

### 4. Configure & deploy the frontend

1. Edit `public/js/config.js`:
   ```js
   window.TRUEPOSE_CONFIG = {
     SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
     SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
     API_BASE: "https://truepose-ai-api.YOUR-SUBDOMAIN.workers.dev"
   };
   ```
2. In `worker/wrangler.toml`, set `ALLOWED_ORIGIN` to your Pages URL (after the
   first Pages deploy you'll know it), then `npx wrangler deploy` again.
3. **Cloudflare Pages → Create project → Connect to Git** → pick this repo →
   set **build output directory = `public`** (no build command needed).

### 5. Preloaded locations (optional but recommended)

Add your real location photos and list them in `public/js/locations.js`:
```js
window.PRELOADED_LOCATIONS = [
  { id: 'studio_white', name: 'Studio White', src: 'img/locations/studio_white.jpg' },
  { id: 'garden',       name: 'Garden',       src: 'img/locations/garden.jpg' },
];
```
Host the images under `public/img/locations/` (create the folder).

---

## Daily operations (admin)

You run everything from the **Supabase Table Editor** for now.

**Approve a new signup + grant free credits:**
1. `owners` table → find the new row (`status = pending`).
2. Set `status` → `approved`.
3. Set `credit_balance` → `6` (the free trial).

**Top up a paying customer:** edit their `credit_balance` (each credit = ₹20).
Optionally add a matching row in `transactions` for your own record.

**See usage:** the `usage_last_30d` view shows images/models/videos/credits per
owner for the last 30 days.

> Tip: Supabase can email you on new signups via a Database Webhook on
> `owners` inserts — set one up later when you want notifications.

---

## How a generation flows

1. Browser sends prompt + images + the user's Supabase token to the Worker.
2. Worker verifies the token, checks status/balance/storage.
3. Worker **atomically deducts** credits.
4. Worker calls Gemini (or Veo). **On hard failure it refunds** the credits.
5. On success it stores the file in R2 and writes a `generations` row.
6. Browser fetches the file (auth'd) and shows it, with PNG/JPEG download.

---

## Tuning (no code changes)

In `worker/wrangler.toml [vars]`:
- `IMAGE_SIZE` — `1K` / `2K` / `4K` (cost vs quality)
- `MIN_GENERATION_BALANCE` — the low-balance hard-stop floor (default 5)
- `STORAGE_CAP` — items per user (default 200)
- `VIDEO_SECONDS` — video length (default 8)

## Reskin

Edit `public/css/theme.css` only. Change `--accent` / `--accent-hover` to
rebrand the whole UI.

---

## Not included yet (deliberate, add later)

- Payment gateway (manual top-ups for now)
- Custom admin panel (using Supabase Table Editor for now)
- Low-balance / signup notification emails (add via Supabase webhooks)
