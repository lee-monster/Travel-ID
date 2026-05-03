# Travel-ID Project Guidelines

## Project Overview
Travel-ID (`travel-id.kr` — placeholder until domain decision) is a community-driven
travel guide for **Indonesia AND Malaysia**, serving both international visitors
AND local residents (domestic travelers) of either country. Forked & adapted from
TravelKo (travel.koinfo.kr) on 2026-05-03; expanded to Malaysia + Arabic on 2026-05-03.

Two audiences with subtly different UX:
- International visitors get visa, SIM, currency, and embassy info; pricing in IDR/MYR
  with USD context.
- Local residents (`prefs.visitType === 'local'`) get local-currency-only pricing
  (IDR or MYR), KAI/Pelni (ID) and KTM ETS / KLIA Ekspres (MY) surfaced over flights,
  e-wallet payment hints (GoPay/OVO/DANA in ID; Touch'n Go eWallet/GrabPay/Boost in MY).

## Architecture
- **SPA**: single `index.html` + `js/travel-app.js` (no framework)
- **7 languages**: en (default), id, ms (peer languages for locals), ko, zh, ja, ar (RTL)
- **Vercel Serverless**: API endpoints in `/api/*` (Notion-backed)
- **Single map provider**: Google Maps only (Naver Maps does not cover ID/MY)
- **Auth**: Google OAuth → Travel-ID issues HS256 JWT (no Supabase)
- **RTL**: `<html dir="rtl">` + `body.rtl` class auto-applied when `ar` is selected

## Tech Stack
- Vanilla HTML/CSS/JS
- Vercel deployment
- Notion API as primary content backend
- Google Maps JS API (frontend) + Google Geocoding API (server)
- Google Identity Services + custom JWT
- Gemini 2.0 Flash AI Planner (with Google Search Grounding, Indonesia-tuned prompt)

## File Structure
```
├── index.html              SPA entrypoint, brand-Indonesia SEO/OG/JSON-LD
├── plan.html               Shared-plan landing
├── privacy.html, terms.html
├── offline.html, sw.js     PWA offline shell
├── manifest.json           PWA manifest (theme #E11D2E)
├── vercel.json             Routes & cache headers
├── package.json            Single dep: @notionhq/client
├── robots.txt              Sitemap pointer
├── css/travel-app.css      Indonesia-themed palette (red+emerald)
├── js/travel-app.js        Main SPA logic
├── sites/travel/lang.js    5-language translation catalog
├── images/                 OG image, splash, brand mark (placeholders)
├── icons/                  PWA icons
└── api/
    ├── _lib/notion.js      Notion client + spot/user accessors
    ├── _lib/auth.js        JWT sign/verify + Google ID token verification
    ├── map-config.js       Public client config (Google keys only)
    ├── travel-spots.js     Spot list + SSR spot detail page
    ├── travel-submit.js    Community spot submission
    ├── travel-planner.js   AI planner (Indonesia + visitor-type aware)
    ├── geocode.js          Google Geocoding (region=id biased)
    ├── place-photos.js     Google Places photos proxy
    ├── share-plan.js       Save / fetch shared plans (Notion)
    ├── sitemap.js          5 lang × spots sitemap
    ├── auth/google.js      Google ID token → Travel-ID JWT
    └── user/bookmarks.js   Per-user bookmark CRUD
```

## Vercel Environment Variables
| Variable | Purpose | Notes |
|---|---|---|
| `NOTION_TOKEN_TRAVEL` | Notion integration token | Share `Travel-ID` parent page with the integration |
| `NOTION_DB_TRAVEL` | Spots DB ID | `10e3dd6ce89841e98a211c5ac4fd2449` |
| `NOTION_DB_USERS` | Users DB ID | `d4a523eeebae48eb868a61259ec1d98d` |
| `NOTION_DB_SHARED_PLANS` | SharedPlans DB ID (optional override) | Defaults to `43e9ab1e470d4894a708e8a6a2f513d5` |
| `GOOGLE_MAPS_API_KEY` | Frontend Maps JS key | Restrict to HTTP referrer (your domain) |
| `GOOGLE_GEOCODING_API_KEY` | Server geocoding/places key | Restrict by IP (Vercel egress IPs) |
| `GOOGLE_CLIENT_ID` | OAuth client id | Add domain to Authorized JavaScript origins |
| `JWT_SECRET` | HS256 secret | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GEMINI_API_KEY` | AI planner | https://aistudio.google.com/app/apikey |

## Notion Databases (created 2026-05-03 via Notion MCP)
Parent page: <https://www.notion.so/355722c54b8881548b33fa2f1417ba1d>

### Travel-ID Spots (`10e3dd6ce89841e98a211c5ac4fd2449`)
Multi-language spot catalog. Property highlights:
- Title: `Name` (English canonical)
- Multi-lang names: `Name_id`, `Name_ms`, `Name_ko`, `Name_zh`, `Name_ja`, `Name_ar`
- Multi-lang descriptions: `Description`, `Description_id`, `Description_ms`, `Description_ko`, `Description_zh`, `Description_ja`, `Description_ar`
- `Category` (select): beach, temple, cultural, volcano, nature, diving, food, cafe, shopping, nightlife, mosque, museum, adventure, wellness
- `Region` (select):
  - **Indonesia**: Bali, Jakarta, Yogyakarta, Bandung, Lombok, Komodo, Surabaya, Medan, Bromo, Borobudur, Raja Ampat, Sumatra, Sulawesi, Kalimantan
  - **Malaysia**: Kuala Lumpur, Penang, Langkawi, Melaka, Sabah, Sarawak, Cameron Highlands, Johor Bahru, Ipoh, Putrajaya
- Coordinates: `Latitude`, `Longitude`
- Halal/Muslim fields: `Halal` (checkbox), `PrayerRoom` (checkbox; covers musholla in ID & surau in MY), `VegFriendly`
- Pricing: `EntryFeeIDR` (number — labeled IDR but reused for MYR by convention; UI shows currency from Region)
- Other: `BestTimeToVisit` (select), `LocalTips` (text), `OpeningHours`, `Tags` (multi_select)
- Publish gate: `Published` (checkbox; spots are invisible until set true)
- 36 seed spots loaded: 24 Indonesia + 12 Malaysia, across every region

### Travel-ID Users (`d4a523eeebae48eb868a61259ec1d98d`)
Title `Email`, plus `GoogleId`, `Name`, `Picture`, `Locale`, `Bookmarks` (JSON), `Plans` (JSON; doubles as planner usage tracker).

### Travel-ID SharedPlans (`43e9ab1e470d4894a708e8a6a2f513d5`)
Title `ShareId` (8-hex). `PlanTitle`, `Days`, `Budget`, `Style`, `Lang`, `SpotNames` (JSON), `PlanHtml` (chunked rich_text up to ~60k chars).

## Auth flow
1. Browser loads Google Identity Services, prompts user.
2. On callback, browser POSTs the Google credential JWT to `/api/auth/google`.
3. Server verifies the credential against Google's tokeninfo endpoint, looks up
   (or creates) a Notion Users row, and returns a Travel-ID HS256 JWT.
4. Browser stores the JWT in `localStorage.travelid_token` and sends it as
   `Authorization: Bearer …` on subsequent calls.

## AI Planner notes
- Prompt is **island/peninsula-aware** — Indonesia + Malaysia together span 5,000+ km
  with both archipelagos and a peninsula. The planner is told to group spots by
  ISLAND/PENINSULA first to avoid impossible same-day routes.
- Cross-border ID↔MY: prompt includes flight pricing (KL↔Jakarta, KL↔Bali, Penang↔Medan).
- `visitType === 'local'` produces a domestic-traveler plan: no visa/SIM/currency,
  local-currency-only pricing (IDR or MYR), KAI/Pelni (ID) or KTM ETS / KLIA Ekspres
  (MY) preferred over flights, e-wallet payment hints in both currencies.
- `respondLang === 'ar'`: planner generates the entire itinerary in Modern Standard
  Arabic; markdown renders RTL automatically when paired with `<html dir="rtl">`.
- Reference transport prices (ID flights/ferry/KAI/Whoosh HSR; MY KTM ETS/KLIA
  Ekspres/AirAsia/Grab) are embedded in the system prompt — refresh annually.
- Daily rate-limit: 20 plans/user; usage state piggybacks on `Plans` rich_text in
  the Notion Users row.

## Languages
- User-facing: choose dynamically. Resolution order:
  1. URL `?lang=`
  2. localStorage (`travelid_lang`)
  3. Browser `navigator.language` (collapses `zh-*` → zh, `ar-*` → ar)
  4. Timezone heuristic: Asia/Jakarta family → id; Asia/Kuala_Lumpur / Asia/Kuching → ms
  5. English fallback
- RTL: when `ar` is selected, `<html dir="rtl">` and `body.rtl` are set; CSS overrides
  in `css/travel-app.css` (search "RTL Support") flip layout where needed. Map controls
  stay LTR (Google Maps native chrome doesn't honor dir reliably).
- Code comments: English.
- Commit messages: English.
- All seven language strings live in `sites/travel/lang.js` — keep them in sync
  when adding a new key.

## Workflow: Session Start Protocol
Before any new task:
1. `git status` — uncommitted changes / untracked
2. `git diff` — in-progress edits
3. `git log --oneline -5` — recent history
4. Summarize to the user, then proceed.

## Pending follow-ups
- Domain decision (placeholder is `travel-id.kr`)
- Replace splash/main/icon images with Indonesia-branded artwork
- GA4 measurement ID is currently `G-XXXXXXXXXX` — replace once registered
- (Optional) Notion → Postgres migration once spot count exceeds ~1k
