# Travel-ID Deploy Guide

Step-by-step bootstrap for a fresh deployment. Allow ~30-45 minutes the first time.

## 1. GitHub repo (already done)
Repo lives at `https://github.com/lee-monster/Travel-ID`. Vercel pulls from `main`.

## 2. Supabase — co-tenant with TravelKo
Travel-ID shares the existing TravelKo Supabase project to stay within the
free-tier 2-project limit. All Travel-ID tables live in a dedicated `travelid`
PostgreSQL schema; TravelKo's `public.*` tables remain untouched. The
`auth.users` table is shared (single sign-in pool).

1. Open the existing **TravelKo Supabase project**.
2. Reuse credentials from **Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret)
3. **Run Travel-ID migrations**. Open **SQL Editor → New query** and paste each
   file in order:
   - Paste `supabase/migrations/0001_init.sql` → Run
     (creates `travelid` schema + all tables + RLS + trigger + backfills profiles
     for any existing TravelKo users)
   - Paste `supabase/migrations/0002_demo_seed.sql` → Run (6 demo spots)

   Verify in **Table Editor → travelid → spots**: should have 6 rows;
   `travelid.spot_translations` ~42 rows.

4. **Expose the schema**: **Settings → API → Exposed schemas** → add `travelid`
   alongside `public` → **Save**. (PostgREST refuses to query schemas that
   aren't explicitly exposed.)

5. **Google auth provider** is likely already configured for TravelKo —
   reuse the same setup. The Supabase callback URL in **Authentication →
   Providers → Google** must already be in your Google Cloud OAuth Authorized
   redirect URIs from the TravelKo deployment.

## 3. Google Cloud project
1. Create a project at <https://console.cloud.google.com/>
2. Enable APIs: **Maps JavaScript API**, **Places API (New)**, **Geocoding API**.
3. **Credentials → Create Credentials → API key** twice:
   - **Frontend key** (`GOOGLE_MAPS_API_KEY`): restrict to *HTTP referrers* —
     `https://travel-id.vercel.app/*`, `https://*.vercel.app/*`,
     `http://localhost:*/*`, plus your future domain.
   - **Server key** (`GOOGLE_GEOCODING_API_KEY`): leave unrestricted at first;
     lock to Vercel egress IPs after the first deploy.
4. **Credentials → Create Credentials → OAuth Client ID → Web application**:
   - Authorized JavaScript origins: `https://travel-id.vercel.app`,
     `https://*.vercel.app`, `http://localhost:3000`, `http://localhost:8000`
   - Authorized redirect URIs: paste the Supabase callback from step 2.4
     (`https://<project>.supabase.co/auth/v1/callback`)
   - Copy Client ID → `GOOGLE_CLIENT_ID`
   - Copy Client Secret → also paste in Supabase → Auth → Providers → Google
5. (Optional) Verify your domain at <https://search.google.com/search-console>
   for OAuth consent.

## 4. Gemini API key
1. <https://aistudio.google.com/app/apikey> → Create API key.
2. Copy into `GEMINI_API_KEY`.

## 5. Vercel environment variables
Vercel → **Travel-ID project → Settings → Environment Variables** → add the
following (Production, Preview, Development all checked):

```
PUBLIC_SITE_URL              https://travel-id.vercel.app
SUPABASE_URL                 (step 2.2 - same as TravelKo)
SUPABASE_ANON_KEY            (step 2.2 - same as TravelKo)
SUPABASE_SERVICE_ROLE_KEY    (step 2.2 - same as TravelKo)
SUPABASE_SCHEMA              travelid
GOOGLE_MAPS_API_KEY          (step 3.3 - frontend key)
GOOGLE_GEOCODING_API_KEY     (step 3.3 - server key)
GOOGLE_CLIENT_ID             (step 3.4 - reuse TravelKo's if same Google project)
GEMINI_API_KEY               (step 4)
```

Then **Deployments → latest → Redeploy** to pick them up.

## 6. (Optional) Import the 36 Notion spots
The demo seed has only 6 spots. To load the full 36 spots from the Notion DB:

```bash
npm install
cp .env.example .env.local
# Fill in NOTION_TOKEN_TRAVEL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
node -r dotenv/config scripts/migrate-notion-to-supabase.js dotenv_config_path=.env.local
```

The script is idempotent (upserts on lower(name)) — safe to re-run.

## 7. Domain
Once you've decided on a domain:
1. Vercel Project → Settings → Domains → add it.
2. At your DNS registrar, add the CNAME / A records Vercel suggests.
3. Once SSL provisions (~5 min):
   - Update `PUBLIC_SITE_URL` env var to the new domain → Redeploy
   - Update Google OAuth Authorized JavaScript origins
   - Update Google Maps API key referrer restrictions

## 8. Verification
- Visit `/` — splash screen → map centered on Bali, list of seeded spots loads
  (6 demo spots; 36 after migration).
- Click a spot — detail panel opens with photos, Google Maps deep link.
- Switch language: `id` → Bahasa Indonesia, `ms` → Bahasa Melayu, `ar` → page
  flips to right-to-left layout. Spot names/descriptions reload.
- Region filter → groups Indonesia 🇮🇩 and Malaysia 🇲🇾 separately.
- Sign in with Google — your name appears top-right; Supabase Dashboard →
  Authentication → Users shows the new user.
- Bookmark a spot to "Want to Visit" — toggle persists across reloads.
  (Verify: Supabase Table Editor → bookmarks has the row.)
- AI Planner → pick 2-3 spots → cross-border itinerary with IDR / MYR pricing.
- Toggle Travel Settings → "Local Resident" → re-open Tips: visa/SIM sections
  disappear.

## 9. Operating cadence
- Community-submitted spots land in `spot_submissions` (status='pending').
  Review via Supabase Dashboard → Table Editor.
- Approved spots go into `spots` (set `published = true`). Translations go into
  `spot_translations`.
- API responses cached at edge (60s) — content goes live on next refresh.

## 10. Rollback
- Each Vercel deployment is immutable. Revert via Vercel dashboard → Deployments
  → ⋯ → Promote to production.
- Supabase has Point-in-Time Recovery on paid plans; on Free tier, manual
  pg_dump backups are recommended weekly.
