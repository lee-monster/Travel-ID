# Next Session — Resume from here

> This file is committed to git, so `git pull` on any PC will retrieve it.
> The companion `WORK_LOG.md` (gitignored, OneDrive-synced) has more detail.

## Tomorrow's first command (on the other PC)

```bash
cd "C:\Users\User\OneDrive\0_project\TravelID"
git status                        # should be clean
git pull origin main              # latest from GitHub
git log --oneline -5              # confirm latest commit
```

**Latest commit as of session close (2026-05-04)**:
`9760228 — SQL audit: add explicit search_path to all SECURITY DEFINER functions`

If `git pull` says "already up to date" and the latest commit matches, you're
synced.

---

## What was completed today (2026-05-04)

- ✅ Pivoted from Notion → Supabase (rewrote all APIs, frontend auth)
- ✅ Co-tenanted with TravelKo Supabase project (`travelid` schema isolation)
- ✅ Ran `0001_init.sql` + `0002_demo_seed.sql` on Supabase
- ✅ Added `travelid` to Supabase Exposed Schemas

## What remains — pick up from here

### 🔥 Step 1 — Set Vercel env vars (5 min)
Vercel dashboard → Travel-ID project → Settings → Environment Variables.
Add the following (Production / Preview / Development all checked):

```
PUBLIC_SITE_URL              https://travel-id.vercel.app
SUPABASE_URL                 (same as TravelKo)
SUPABASE_ANON_KEY            (same as TravelKo)
SUPABASE_SERVICE_ROLE_KEY    (same as TravelKo)
SUPABASE_SCHEMA              travelid
GOOGLE_MAPS_API_KEY          (frontend key — restrict to HTTP referrers)
GOOGLE_GEOCODING_API_KEY     (server key)
GOOGLE_CLIENT_ID             (reuse TravelKo's if same Google project)
GEMINI_API_KEY               (from aistudio.google.com)
```

### Step 2 — Redeploy
Vercel → Deployments → latest → ⋯ → Redeploy

### Step 3 — Verify (run from your PC)
```bash
curl https://travel-id.vercel.app/api/map-config
# Expect: { "googleKey": "AIza...", "googleClientId": "...", "supabaseUrl": "https://...", "supabaseAnonKey": "...", "supabaseSchema": "travelid", "siteUrl": "..." }

curl "https://travel-id.vercel.app/api/travel-spots?lang=en&limit=3"
# Expect: { "spots": [...3 demo spots...], "hasMore": true, ... }

curl https://travel-id.vercel.app/sitemap.xml | head -20
# Expect: URLs starting with https://travel-id.vercel.app/
```

### Step 4 — Browser smoke test
Open https://travel-id.vercel.app/ — verify:
- Splash → map shows on Bali
- 6 demo spots appear (3 in ID, 3 in MY)
- Language switch works (try `ar` for RTL)
- Region filter shows ID 🇮🇩 / MY 🇲🇾 grouped
- Sign-in with Google works → name appears top-right

### (Optional) Step 5 — Migrate the remaining 30 Notion spots
```bash
npm install
cp .env.example .env.local
# Fill .env.local with NOTION_TOKEN_TRAVEL + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
node -r dotenv/config scripts/migrate-notion-to-supabase.js dotenv_config_path=.env.local
```

---

## Reference docs (in this repo)

- `CLAUDE.md`         — full architecture, schema, auth flow
- `DEPLOY.md`         — step-by-step deployment (this file is a quick excerpt)
- `README.md`         — high-level overview
- `WORK_LOG.md`       — historical work log (gitignored, OneDrive-only)

## Key external resources

- GitHub repo:        https://github.com/lee-monster/Travel-ID
- Vercel project:     https://vercel.com/dashboard → Travel-ID
- Supabase project:   (same as TravelKo dashboard)
- Notion parent page: https://www.notion.so/355722c54b8881548b33fa2f1417ba1d

## If OneDrive lost something

GitHub is the source of truth. Local OneDrive folder may have stale or
half-synced files. To force-resync from authoritative source:

```bash
cd "C:\Users\User\OneDrive\0_project\TravelID"
git fetch origin
git reset --hard origin/main      # ⚠️ wipes uncommitted local changes
```

Don't run `git reset --hard` unless you're sure no uncommitted work exists
locally. `git status` first to check.
