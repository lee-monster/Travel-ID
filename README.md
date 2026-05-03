# Travel-ID

> Discover Indonesia & Malaysia — for international tourists and local residents alike.

Community-driven travel guide for Indonesia and Malaysia. Bali, Yogyakarta, Komodo,
Bromo, Kuala Lumpur, Penang, Langkawi, Borneo — with halal / prayer-room info, AI
trip planning, and an interactive Google Map. Seven languages: English, Bahasa
Indonesia, Bahasa Melayu, 한국어, 中文, 日本語, العربية (RTL).

## Stack
- Vanilla HTML / CSS / JS (no framework, no build step)
- Vercel serverless functions (Node 18+)
- Notion API as primary content backend
- Google Maps + Geocoding + Places APIs
- Gemini 2.0 Flash for AI itinerary generation
- Google Identity Services + HS256 JWT for auth

## Quick start (local)
```bash
npm install
cp .env.example .env.local      # fill in your keys
npx vercel dev                  # serves the SPA + APIs at http://localhost:3000
```

You'll need:
- A Notion integration token + the three Notion DB IDs (spots / users /
  shared-plans). The DBs are pre-created — see CLAUDE.md for IDs.
- Google Maps JS + Geocoding API keys.
- Google OAuth Client ID (web type).
- A 64+ char `JWT_SECRET`.
- A Gemini API key.

See [DEPLOY.md](./DEPLOY.md) for end-to-end deployment instructions.

## Project structure
See [CLAUDE.md](./CLAUDE.md).

## License
Private project. All rights reserved by the author.
