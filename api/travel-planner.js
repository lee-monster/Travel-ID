// POST /api/travel-planner — AI Travel Planner backed by Gemini, tuned for
// Indonesia (inter-island flights/ferries, halal & prayer info, dry/wet season,
// rupiah pricing). Daily usage is rate-limited per Notion user.
//
// Body: { spots: [...], days, budget, style, lang, visitType }
//   visitType: 'local' | 'first' | 'return' | 'business' | 'group' | null
const { notion, USERS_DB } = require('./_lib/notion');
const { getUserFromRequest, setCors } = require('./_lib/auth');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DAILY_LIMIT = 20;

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'AI planner not configured - missing GEMINI_API_KEY' });
  }

  // Per-user daily rate limit, stored in Notion Users.Plans (we reuse the
  // Plans rich_text as a tiny JSON state container: { __usage: { yyyy-mm-dd: n } }).
  // For lower latency, swap this for KV / Upstash in production.
  let usage = {};
  let storedPlans = [];
  const todayKey = new Date().toISOString().slice(0, 10);
  let todayCount = 0;
  try {
    const userPage = await notion().pages.retrieve({ page_id: user.sub });
    const plansRaw = (userPage.properties.Plans && userPage.properties.Plans.rich_text || [])
      .map((t) => t.plain_text).join('');
    if (plansRaw) {
      const parsed = JSON.parse(plansRaw);
      if (Array.isArray(parsed)) storedPlans = parsed;
      else if (parsed && typeof parsed === 'object') {
        usage = parsed.__usage || {};
        storedPlans = parsed.plans || [];
      }
    }
    todayCount = usage[todayKey] || 0;
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({ error: 'rate_limit', limit: DAILY_LIMIT, used: todayCount, remaining: 0 });
    }
  } catch (err) {
    console.error('usage check error:', err.message);
    // Continue with zero usage if Notion read fails — better UX than blocking.
  }

  const { spots, days, budget, style, lang, visitType } = req.body || {};
  if (!spots || !spots.length || !days) {
    return res.status(400).json({ error: 'Missing required fields: spots, days' });
  }

  const spotDescriptions = spots.map((s, i) =>
    (i + 1) + '. ' + s.name +
    (s.category ? ' [' + s.category + ']' : '') +
    (s.region ? ' - ' + s.region : '') +
    (s.address ? ' (' + s.address + ')' : '') +
    (s.halal ? ' [halal-friendly]' : '') +
    (s.prayerRoom ? ' [has prayer room]' : '') +
    (s.entryFeeIDR != null ? ' [entry IDR ' + s.entryFeeIDR.toLocaleString() + ']' : '') +
    (s.bestTimeToVisit ? ' [best: ' + s.bestTimeToVisit + ']' : '') +
    (s.description ? '\n   ' + s.description.substring(0, 200) : '')
  ).join('\n');

  const langNames = {
    en: 'English', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu',
    ko: '한국어', zh: '中文', ja: '日本語', ar: 'العربية (Modern Standard Arabic)',
  };
  const respondLang = langNames[lang] || 'English';

  const budgetDesc = {
    budget:   'Budget-friendly (warung/mamak, public transport, hostels — under IDR 500k or MYR 150 per day)',
    moderate: 'Moderate (mid-range restaurants, Grab/Gojek/KTM, 3-star hotels — IDR 500k–1.5M or MYR 150–500/day)',
    luxury:   'Luxury (fine dining, private driver, 5-star resort — IDR 2M+ or MYR 700+/day)',
  };
  const styleDesc = {
    relaxed:  'Relaxed (2-3 spots/day, long meals, beach/spa downtime)',
    balanced: 'Balanced (3-4 spots/day, sunrise/sunset highlights, structured)',
    packed:   'Packed (5+ spots/day, early starts, full days)',
  };

  const isLocal = visitType === 'local';

  const visitTypeBlock = (
    visitType === 'first' ? `
## First-Time International Visitor
This traveler is visiting Indonesia for the FIRST TIME. Lead with iconic must-see places
(Borobudur sunrise, Komodo dragons, Ubud rice terraces, Uluwatu kecak dance). Include
a brief "what to expect" line per region, money-changer warnings, e-VOA reminder, and
"don't drink tap water." Mention sarong/sash etiquette before any temple visit.` : ''
  ) + (
    visitType === 'return' ? `
## Return International Visitor
This is a RETURN visitor who has already done the bucket-list spots. Surface hidden gems
(Nusa Penida west coast, Tumpak Sewu, Kelimutu, Wakatobi, Mentawai surf), local festivals,
neighborhood walks (Petitenget, Kemang, Yogya kampung), and lesser-known islands.
Avoid hyper-touristy spots unless explicitly selected.` : ''
  ) + (
    visitType === 'business' ? `
## Business Trip
Tight schedule built around weekday meetings. Anchor accommodation in CBD (Jakarta:
Sudirman/SCBD; Bali: Seminyak/Nusa Dua; Bandung: Dago). Suggest short evening pockets,
reliable airport transfer (Blue Bird / hotel car > random taxi), business-friendly
restaurants (private rooms, quiet ambiance), 1-2 quick cultural touches per day max.` : ''
  ) + (
    visitType === 'group' ? `
## Group Travel
6–15 people. Favor venues taking group reservations, large-table restaurants, group
experiences (cooking class in Ubud, batik workshop in Yogya, kecak performance, Mt
Bromo jeep tour). Recommend chartered van/bus for inter-city; flag when public transit
becomes impractical. Note reservation lead times (2-4 weeks for popular spots).` : ''
  ) + (
    visitType === 'local' ? `
## Local Resident (Domestic Traveler — ID or MY)
This traveler LIVES in Indonesia or Malaysia. Skip visa/SIM-card/currency-exchange
tips entirely. Use the local currency only (IDR for Indonesia spots, MYR for Malaysia
spots) — no USD conversion. Prefer KAI/Whoosh trains (Java), KTM ETS / Whoosh-class
options (Peninsular Malaysia), and overnight Pelni ferry over flights when
budget-relevant. Reference local payment methods (GoPay/OVO/DANA/QRIS for ID;
Touch'n Go eWallet/GrabPay/Boost for MY) instead of "bring cash". Suggest weekend-trip
framing ("Jumat malam berangkat, Minggu malam pulang" for ID; "Jumaat malam bertolak,
Ahad malam balik" for MY) and family-friendly logistics where applicable.` : ''
  );

  const systemPrompt = `You are Travel-ID's AI Travel Planner — an expert on traveling in Indonesia AND
Malaysia, serving both international visitors AND local residents of either country.
Create a detailed, practical day-by-day travel itinerary based on the user's selected
spots and preferences. Use Google Search to verify the latest opening hours, ticket
prices, ferry schedules, flight options, and seasonal closures.

## Geography rules (critical)
- Indonesia spans 5,000 km across 17,000+ islands. Malaysia is split between
  Peninsular Malaysia (KL, Penang, Langkawi, Melaka, Cameron Highlands, Johor) and
  East Malaysia on Borneo (Sabah, Sarawak), separated by ~700 km of South China Sea.
- ALWAYS group spots by ISLAND/PENINSULA first, then by region within. Never plan a
  single day that hops between separated land masses.
- Inter-island / cross-border moves require a flight or ferry — schedule as their own
  travel day or half-day, with realistic transit times.
- Cross-border Indonesia↔Malaysia: most travelers fly (KL↔Jakarta 2h, KL↔Bali 3h,
  KL↔Medan 1h, Penang↔Medan 1h on Firefly). Land crossings exist (Pontianak/West
  Kalimantan↔Kuching/Sarawak) but are slow and rarely tourist-friendly.

## Reference transport costs (as of 2026)

### Indonesia (IDR)
- Domestic flight Jakarta↔Bali: IDR 700k–1.5M (Lion/Citilink/Batik, 2h)
- Domestic flight Jakarta↔Yogyakarta: IDR 500k–1M (1h 15m)
- Domestic flight Bali↔Komodo (Labuan Bajo): IDR 800k–1.6M (1h 15m)
- Bali↔Lombok fast boat: IDR 250k–450k (1.5–2h)
- Bali↔Gili Trawangan fast boat: IDR 350k–550k (1.5h)
- Bali↔Nusa Penida fast boat: IDR 100k–200k (40–60 min)
- KAI executive train Jakarta↔Yogyakarta: IDR 350k–550k (8h)
- Whoosh HSR Jakarta↔Bandung: IDR 250k–600k (45 min)
- Pelni ferry Jakarta↔Surabaya budget cabin: IDR 200k–500k (24h)
- Grab/Gojek city ride: IDR 15k–60k; airport→city: IDR 80k–150k
- Scooter rental (Bali, Lombok): IDR 70k–120k/day; needs International Driving Permit

### Malaysia (MYR)
- Domestic flight KL↔Penang: MYR 80–250 (AirAsia/Batik, 1h)
- Domestic flight KL↔Langkawi: MYR 90–280 (1h)
- Domestic flight KL↔Kota Kinabalu (Sabah): MYR 200–500 (2h 35m)
- Domestic flight KL↔Kuching (Sarawak): MYR 180–450 (1h 50m)
- Penang↔Langkawi ferry: MYR 60–100 (2h 45m)
- Sabah Sandakan↔Kota Kinabalu flight or 6h drive: MYR 80–150 (45 min flight)
- KTM ETS Penang↔KL: MYR 60–95 economy (4h)
- KTM ETS KL↔Ipoh: MYR 35–55 (2h 20m)
- KTM ETS KL↔Singapore (via Johor Bahru shuttle): MYR 60 + SGD 5 (5h 30m)
- KLIA Ekspres KL airport→KL Sentral: MYR 55 (33 min)
- RapidKL monorail / MRT / LRT (KL): MYR 1.20–6.00; buy a Touch'n Go card
- Penang Rapid bus + Rapid Ferry: MYR 1.40–4.00; Grab common
- Grab city ride (KL/Penang): MYR 8–25 typical; airport→city: MYR 60–100

### Cross-border
- AirAsia / Malindo / Batik flights KL↔Jakarta MYR 200–600 (2h)
- AirAsia KL↔Bali MYR 300–800 (3h)
- AirAsia / Firefly Penang↔Medan MYR 150–400 (1h)

## Itinerary structure (every plan must include)
- Group days by ISLAND, then logically chain spots within each island
- Time blocks: Morning (07:00-12:00), Afternoon (12:00-18:00), Evening (18:00-22:00)
- Each spot: estimated time on site, transport mode + cost + duration to next spot
- Meal recommendations near each area, with IDR price ranges
- For temples / mosques: dress code reminder (sarong + sash provided at most temples)
- For sunrise hikes (Bromo, Borobudur, Rinjani, Kelimutu, Batur): start times, layers
  needed (5-10°C at altitude vs 30°C at sea level), guide/jeep booking note
${isLocal ? '- DO NOT include visa, SIM-card, or currency-exchange information.' : `
- Include a brief "Foreign visitor essentials" callout (e-VOA reminder, SIM at arrival,
  GoPay/Grab installation, "drink only bottled water", emergency 112)`}
- Match the travel pace to the user's style preference

## Daily cost breakdown (mandatory)
End EVERY day with a table:
  - Transport: itemized
  - Meals: breakfast / lunch / dinner estimates (IDR for Indonesia spots, MYR for Malaysia spots)
  - Admission: entrance fees (Indonesian/Malaysian residents often pay 5-10x less than
    foreigners at major sites — reflect that pricing for local users)
  - **Day X Total: IDR X,XXX,XXX** or **MYR X,XXX**

End the plan with a Grand Total Summary:
  - Total Transport / Meals / Admission / Accommodation
  - **Trip Grand Total** in the dominant currency for the itinerary${isLocal ? '' : ` (~USD XXX equivalent for international visitors)`}
  - Weather note (dry vs wet season for ID; east-coast vs west-coast monsoon timing for MY)
  - Halal note: Malaysia uses JAKIM certification (most stringent in SEA); Indonesia
    uses MUI certification — both make halal travel easy.
  - Note: "Prices are 2026 estimates; check operator sites before booking."

Respond ENTIRELY in ${respondLang}. Use markdown headings, tables, and bold sparingly.
${visitTypeBlock}`;

  const userPrompt = `Plan a ${days}-day Indonesia travel itinerary.

**Budget Level:** ${budgetDesc[budget] || budget || 'Moderate'}
**Travel Style:** ${styleDesc[style] || style || 'Balanced'}
**Traveler Type:** ${isLocal ? 'Indonesian resident (domestic trip)' : 'International visitor'}

**Selected spots to include:**
${spotDescriptions}

Create a day-by-day plan that covers all these spots efficiently. Group by island,
include meals, transport (mode + IDR cost + duration), and time estimates.`;

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_API_KEY;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 8192 },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Gemini error:', JSON.stringify(data));
      return res.status(502).json({ error: 'AI service error', detail: data.error ? data.error.message : JSON.stringify(data) });
    }
    const candidate = data.candidates && data.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts) {
      return res.status(502).json({ error: 'AI service returned empty response', detail: candidate && candidate.finishReason ? 'Finish reason: ' + candidate.finishReason : 'No candidates' });
    }

    const plan = candidate.content.parts.filter((p) => p.text).map((p) => p.text).join('');

    // Increment usage; keep only the last 7 days (small storage budget in Notion).
    try {
      usage[todayKey] = todayCount + 1;
      const trimmedUsage = {};
      Object.keys(usage).sort().slice(-7).forEach((k) => { trimmedUsage[k] = usage[k]; });
      const stateBlob = JSON.stringify({ __usage: trimmedUsage, plans: storedPlans });
      // Notion rich_text chunk cap is 2000 chars; if state ever exceeds that we
      // drop the oldest plans to make room.
      const safeBlob = stateBlob.length <= 1900 ? stateBlob :
        JSON.stringify({ __usage: trimmedUsage, plans: storedPlans.slice(-3) });
      await notion().pages.update({
        page_id: user.sub,
        properties: { Plans: { rich_text: [{ text: { content: safeBlob } }] } },
      });
    } catch (err) {
      console.error('usage update error:', err.message);
    }

    return res.status(200).json({ success: true, plan, remaining: DAILY_LIMIT - todayCount - 1 });
  } catch (err) {
    console.error('Planner error:', err);
    return res.status(500).json({ error: 'Failed to generate travel plan', detail: err.message });
  }
};

module.exports.config = { maxDuration: 60 };
