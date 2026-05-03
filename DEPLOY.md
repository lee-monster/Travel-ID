# Travel-ID Deploy Guide

Step-by-step bootstrap for a fresh deployment. Allow ~30 minutes the first time.

## 1. GitHub repo
1. Create a new GitHub repo (suggested: `lee-monster/Travel-ID`).
2. From this directory:
   ```bash
   git remote add origin https://github.com/lee-monster/Travel-ID.git
   git add .
   git commit -m "Initial Travel-ID import (forked from TravelKo, adapted for Indonesia)"
   git branch -M main
   git push -u origin main
   ```

## 2. Notion integration
The Notion databases are pre-created (see CLAUDE.md for IDs). You only need to:
1. Visit <https://www.notion.so/my-integrations> and create a new internal
   integration named "Travel-ID". Copy the secret token.
2. Open the **Travel-ID** parent page in Notion
   (<https://www.notion.so/355722c54b8881548b33fa2f1417ba1d>) → click "…" →
   *Connections → Add connection → Travel-ID*. This grants access to all child
   databases automatically.

## 3. Google Cloud project
1. Create a project at <https://console.cloud.google.com/>
2. Enable APIs: Maps JavaScript API, Places API (New), Geocoding API.
3. Create credentials → API key. Make **two** keys:
   - **Frontend key** (`GOOGLE_MAPS_API_KEY`): restrict to *HTTP referrers* —
     `https://travel-id.kr/*`, `https://*.vercel.app/*`, `http://localhost:*/*`.
   - **Server key** (`GOOGLE_GEOCODING_API_KEY`): restrict by *IP addresses* —
     leave blank initially, lock to Vercel egress IPs after first deploy.
4. Create OAuth credentials → Web application:
   - Authorized JavaScript origins: `https://travel-id.kr`, `https://*.vercel.app`, `http://localhost:3000`
   - Copy the Client ID into `GOOGLE_CLIENT_ID`.
5. (Optional) Verify your domain at <https://search.google.com/search-console>
   for OAuth consent.

## 4. Gemini API key
1. <https://aistudio.google.com/app/apikey> → Create API key.
2. Copy into `GEMINI_API_KEY`.

## 5. JWT secret
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Copy the output into `JWT_SECRET`.

## 6. Vercel project
1. Visit <https://vercel.com/new> and import the GitHub repo.
2. Framework preset: *Other*. Build command: leave empty. Output dir: leave empty.
3. Environment Variables → add every key from `.env.example`. Select all
   environments (Production, Preview, Development).
4. Deploy. The first build takes ~30 seconds.

## 7. Domain
1. Vercel Project → Settings → Domains → add `travel-id.kr` (or your chosen
   domain).
2. At your DNS registrar, add the CNAME / A records Vercel suggests.
3. Once SSL provisions (~5 min), update OAuth Authorized origins and Maps API
   referrer restrictions to include the production domain.

## 8. First content & verification
- Visit `/` — splash screen → map centered on Bali, list of seeded spots loads
  (24 Indonesia + 12 Malaysia).
- Click a spot — detail panel opens with photos, Google Maps deep link.
- Switch language: `id` → Bahasa Indonesia, `ms` → Bahasa Melayu, `ar` → page
  flips to right-to-left layout. Spot names/descriptions reload.
- Region filter → groups Indonesia 🇮🇩 and Malaysia 🇲🇾 separately.
- Sign in with Google — your name appears top-right.
- Bookmark a spot to "Want to Visit" — toggle persists across reloads.
- AI Planner → pick 2-3 spots from one or both countries → expect a cross-border
  itinerary with IDR / MYR pricing and inter-island/cross-border transport.
- Toggle Travel Settings → "Local Resident" → re-open Tips: visa/SIM sections
  disappear, IDR/MYR-only payment tips appear.

## 9. Operating cadence
- New spots are submitted through the in-app "Share a Spot" button (creates
  rows in Notion with `Published=false`).
- Admin reviews directly in the Notion `Travel-ID Spots` database, fills in
  multi-language fields, sets `Published=true`.
- No code deployment needed for content updates; the next request hits Notion
  directly (cache: 60s edge / 5 min stale).

## 10. Rollback
- Each Vercel deployment is immutable. Revert via Vercel dashboard → Deployments
  → ⋯ → Promote to production.
- Notion content has its own revision history per page.
