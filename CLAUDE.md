# Travel-ID Project Guidelines

## Project Overview
Travel-ID is a community-driven travel guide for **Indonesia AND Malaysia**, serving
both international visitors AND local residents (domestic travelers) of either country.
Forked & adapted from TravelKo (travel.koinfo.kr) on 2026-05-03; expanded to Malaysia
+ Arabic on 2026-05-03; pivoted from Notion to Supabase on 2026-05-04.

Two audiences with subtly different UX:
- International visitors get visa, SIM, currency, and embassy info; pricing in IDR/MYR
  with USD context.
- Local residents (`prefs.visitType === 'local'`) get local-currency-only pricing
  (IDR or MYR), KAI/Pelni (ID) and KTM ETS / KLIA Ekspres (MY) surfaced over flights,
  e-wallet payment hints (GoPay/OVO/DANA in ID; Touch'n Go eWallet/GrabPay/Boost in MY).

## Architecture
- **SPA**: single `index.html` + `js/travel-app.js` (no framework)
- **7 languages**: en (default), id, ms (peer languages for locals), ko, zh, ja, ar (RTL)
- **Vercel Serverless**: API endpoints in `/api/*` (Supabase-backed)
- **Single map provider**: Google Maps only (Naver Maps does not cover ID/MY)
- **Auth**: Supabase Auth via `signInWithIdToken` (Google provider). Frontend stores
  the access token; API routes verify via `supabase.auth.getUser(token)`.
- **RTL**: `<html dir="rtl">` + `body.rtl` class auto-applied when `ar` is selected

## Tech Stack
- Vanilla HTML/CSS/JS
- Vercel deployment (Node 18+)
- Supabase (Postgres + Auth + RLS) as the data + auth backend
- Google Maps JS API (frontend) + Google Geocoding API (server)
- Google Identity Services (sign-in button) + Supabase Auth (session)
- Gemini 2.0 Flash AI Planner (with Google Search Grounding, ID+MY prompt)

## File Structure
```
├── index.html                       SPA entrypoint, brand SEO/OG/JSON-LD
├── plan.html                        Shared-plan landing
├── privacy.html, terms.html
├── offline.html, sw.js              PWA offline shell
├── manifest.json                    PWA manifest (theme #E11D2E)
├── vercel.json                      Routes & cache headers
├── package.json                     Dep: @supabase/supabase-js
├── robots.txt                       Sitemap pointer
├── css/travel-app.css               Indonesia/Malaysia palette + RTL block
├── js/travel-app.js                 Main SPA logic
├── sites/travel/lang.js             7-language translation catalog
├── images/, icons/                  Brand assets (placeholders for now)
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql            Schema (profiles, spots, translations,
│       │                            bookmarks, shared_plans, submissions,
│       │                            events, RLS policies, log_event helper)
│       └── 0002_demo_seed.sql       6 iconic spots in 7 langs
├── scripts/
│   └── migrate-notion-to-supabase.js  One-time importer for the 36 Notion spots
└── api/
    ├── _lib/supabase.js             getSupaPublic + getSupaAdmin + getSiteUrl
    ├── _lib/auth.js                 setCors + getUserFromRequest (Supabase token)
    ├── map-config.js                Public client config (keys + supabaseUrl/anonKey)
    ├── travel-spots.js              Spot list + SSR spot detail page
    ├── travel-submit.js             Community spot submission → spot_submissions
    ├── travel-planner.js            AI planner; planner_usage in profiles
    ├── geocode.js                   Google Geocoding (region=id biased)
    ├── place-photos.js              Google Places photos proxy
    ├── share-plan.js                Save / fetch shared plans
    ├── sitemap.js                   7 lang × spots sitemap
    └── user/bookmarks.js            Per-user bookmark CRUD
```

## Vercel Environment Variables
| Variable | Purpose | Notes |
|---|---|---|
| `PUBLIC_SITE_URL` | Canonical origin | `https://travel-id.vercel.app` (placeholder) |
| `SUPABASE_URL` | Supabase project URL | **Reused** from TravelKo (co-tenant) |
| `SUPABASE_ANON_KEY` | Public anon key | **Reused**; safe to expose, RLS protects rows |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin key | **Reused**; NEVER expose to browser |
| `SUPABASE_SCHEMA` | Postgres schema for our tables | `travelid` (default) |
| `GOOGLE_MAPS_API_KEY` | Frontend Maps JS key | restrict to HTTP referrer |
| `GOOGLE_GEOCODING_API_KEY` | Server geocoding/places key | restrict by IP |
| `GOOGLE_CLIENT_ID` | OAuth client id (Google Identity Services button) | reuse TravelKo's if same Google project |
| `GEMINI_API_KEY` | AI planner | https://aistudio.google.com/app/apikey |

## Supabase — co-tenant with TravelKo
To stay within Supabase's 2-project free-tier limit, Travel-ID and TravelKo
share a single Supabase project. Isolation lives at the **PostgreSQL schema**
level: TravelKo keeps `public.*`, Travel-ID lives in `travelid.*`. The
`auth.users` table is shared (single sign-in pool — a user signed into either
app shares the auth identity).

The Supabase JS client is initialized with `db: { schema: 'travelid' }`, which
makes every `from('spots')` call resolve to `travelid.spots` automatically.
The schema name flows from `SUPABASE_SCHEMA` env var (server) and from the
`/api/map-config` response (browser).

**Required Supabase setting**: Project Settings → API → Exposed schemas must
include `travelid` (alongside `public`). Without this, PostgREST returns 404
for every Travel-ID table.

## Supabase Schema
See `supabase/migrations/0001_init.sql`. Key tables (all in `travelid` schema):
- `profiles` — extends `auth.users` with `display_name`, `avatar_url`,
  `preferred_lang`, `planner_usage` (jsonb, last 7 days)
- `spots` — main catalog. `country` ('ID'|'MY'), `region`, halal/prayer/
  veg_friendly flags, `entry_fee` (numeric, IDR or MYR), `best_time_to_visit`,
  `local_tips`, `opening_hours`, `tags[]`, `featured`, `published`
- `spot_translations` — `(spot_id, lang)` PK, where `lang` ∈ 7 langs
- `bookmarks` — `(user_id, spot_id, type)` PK; type ∈ ('want_to_visit','interested')
- `shared_plans` — saved AI plans, public read by `share_id`
- `spot_submissions` — community submissions (status: pending/approved/rejected)
- `events` — append-only behavior log

RLS:
- Public read of published spots + their translations
- Each user reads/writes only their own bookmarks, profile, submissions
- service_role bypasses RLS for admin / migration scripts

## Auth Flow
1. Browser loads Google Identity Services → renders sign-in button
2. On Google credential callback, browser calls
   `supabase.auth.signInWithIdToken({ provider: 'google', token: credential })`
3. Supabase issues an access_token (JWT) + persists session in localStorage
4. `onAuthStateChange` → `applySupaSession()` updates `state.authUser`
5. API requests send `Authorization: Bearer <access_token>`; routes call
   `supabase.auth.getUser(token)` to validate.

Important: enable **Google as a provider** in Supabase Dashboard → Authentication
→ Providers → Google. Paste the SAME `GOOGLE_CLIENT_ID` (and Client Secret) you
configured in Google Cloud Console.

## AI Planner notes
- Prompt is **island/peninsula-aware** — Indonesia + Malaysia together span 5,000+ km
  with both archipelagos and a peninsula. Spots are grouped by ISLAND/PENINSULA
  first to avoid impossible same-day routes.
- Cross-border ID↔MY: flight pricing (KL↔Jakarta, KL↔Bali, Penang↔Medan).
- `visitType === 'local'` produces a domestic-traveler plan: no visa/SIM/currency,
  local-currency-only pricing (IDR or MYR), KAI/Pelni (ID) or KTM ETS / KLIA Ekspres
  (MY) preferred over flights, e-wallet payment hints in both currencies.
- `respondLang === 'ar'`: planner generates the entire itinerary in Modern Standard
  Arabic; markdown renders RTL when paired with `<html dir="rtl">`.
- Reference prices embedded in the prompt — refresh annually.
- Daily rate-limit: 20 plans/user; usage state in `profiles.planner_usage` (jsonb).

## Languages
- User-facing: choose dynamically. Resolution order:
  1. URL `?lang=`
  2. localStorage (`travelid_lang`)
  3. Browser `navigator.language` (collapses `zh-*` → zh, `ar-*` → ar)
  4. Timezone heuristic: Asia/Jakarta family → id; Asia/Kuala_Lumpur / Kuching → ms
  5. English fallback
- RTL: when `ar` is selected, `<html dir="rtl">` and `body.rtl` are set; CSS overrides
  in `css/travel-app.css` (search "RTL Support"). Map controls stay LTR.
- All seven language strings live in `sites/travel/lang.js` — keep in sync.

## Notion legacy
The 36 spots that were briefly hosted in Notion can be imported with
`scripts/migrate-notion-to-supabase.js` (needs `NOTION_TOKEN_TRAVEL` +
`NOTION_DB_TRAVEL` + Supabase service-role key in `.env.local`). After that,
the Notion DB can be archived.

## Workflow: Session Start Protocol
Before any new task:
1. `git status` — uncommitted / untracked
2. `git diff` — in-progress edits
3. `git log --oneline -5` — recent history
4. Summarize to the user, then proceed.

## Pending follow-ups
- Domain decision (placeholder is `travel-id.vercel.app`)
- Replace splash/main/icon images with branded artwork
- GA4 measurement ID is currently `G-XXXXXXXXXX` — replace once registered
