// GET /api/travel-spots — public spot list backed by Notion.
// Query params:
//   lang     - en | id | ko | zh | ja  (display language; falls back to en)
//   category - single category name OR comma-separated list
//   exclude  - comma-separated category names to exclude
//   region   - region name (Bali, Yogyakarta, …)
//   halal    - "1" to filter halal-friendly spots
//   limit    - max rows (default 100)
//   cursor   - Notion start_cursor for pagination
//
// GET /api/travel-spots?render=page&id=...&lang=...
//   Returns a server-rendered HTML page for share / OG previews.
const { notion, SPOTS_DB, spotFromPage } = require('./_lib/notion');

const LANGS = ['en', 'id', 'ms', 'ko', 'zh', 'ja', 'ar'];

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function listSpots(req, res) {
  const { lang, category, exclude, region, halal, limit, cursor } = req.query || {};
  const l = LANGS.indexOf(lang) !== -1 ? lang : 'en';
  const pageSize = Math.min(parseInt(limit, 10) || 100, 100);

  const filters = [{ property: 'Published', checkbox: { equals: true } }];

  if (category && category !== 'all') {
    const cats = category.split(',').map((s) => s.trim()).filter(Boolean);
    if (cats.length === 1) {
      filters.push({ property: 'Category', select: { equals: cats[0] } });
    } else if (cats.length > 1) {
      filters.push({ or: cats.map((c) => ({ property: 'Category', select: { equals: c } })) });
    }
  }
  if (exclude) {
    const excludeCats = exclude.split(',').map((s) => s.trim()).filter(Boolean);
    excludeCats.forEach((c) => filters.push({ property: 'Category', select: { does_not_equal: c } }));
  }
  if (region) {
    filters.push({ property: 'Region', select: { equals: region } });
  }
  if (halal === '1' || halal === 'true') {
    filters.push({ property: 'Halal', checkbox: { equals: true } });
  }

  try {
    const query = {
      database_id: SPOTS_DB,
      filter: filters.length === 1 ? filters[0] : { and: filters },
      sorts: [
        { property: 'Featured', direction: 'descending' },
        { property: 'Rating', direction: 'descending' },
        { timestamp: 'created_time', direction: 'descending' },
      ],
      page_size: pageSize,
    };
    if (cursor) query.start_cursor = cursor;

    const result = await notion().databases.query(query);
    const spots = result.results.map((page) => spotFromPage(page, l));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.json({
      spots,
      hasMore: result.has_more,
      nextCursor: result.next_cursor || null,
      lang: l,
    });
  } catch (err) {
    console.error('travel-spots error:', err);
    res.status(500).json({ error: 'Failed to load spots', detail: err.message });
  }
}

async function renderSpotPage(req, res) {
  const { id, lang } = req.query || {};
  if (!id) return res.status(400).send('Missing spot id');
  const l = LANGS.indexOf(lang) !== -1 ? lang : 'en';

  try {
    const page = await notion().pages.retrieve({ page_id: id });
    const spot = spotFromPage(page, l);
    if (!spot.name) return res.redirect(302, 'https://travel-id.kr/');

    const e = escHtml;
    const ogImage = spot.coverImage || (spot.photos[0] || 'https://travel-id.kr/images/splash.png');
    const ogTitle = e(spot.name + ' — Travel-ID');
    const ogDesc = e((spot.description || '').substring(0, 200));
    const spotUrl = 'https://travel-id.kr/spot/' + id + (lang ? '?lang=' + lang : '');
    const appUrl = 'https://travel-id.kr/?spot=' + id + (lang ? '&lang=' + lang : '');
    const localeMap = { en: 'en_US', id: 'id_ID', ms: 'ms_MY', ko: 'ko_KR', zh: 'zh_CN', ja: 'ja_JP', ar: 'ar_SA' };
    const dirAttr = l === 'ar' ? ' dir="rtl"' : '';
    const CAT_EMOJI = {
      beach: '🏖️', temple: '🛕', cultural: '🎭', volcano: '🌋',
      nature: '🌿', diving: '🤿', food: '🍜', cafe: '☕',
      shopping: '🛍️', nightlife: '🌙', museum: '🏛️',
      adventure: '🧗', wellness: '🧘',
      mosque: '🕌', halal: '🥘', vegetarian: '🥗',
    };
    const catEmoji = CAT_EMOJI[spot.category] || '📍';

    const html = `<!DOCTYPE html>
<html lang="${l}"${dirAttr}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ogTitle}</title>
<meta name="description" content="${ogDesc}">
<meta property="og:type" content="article">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:image" content="${e(ogImage)}">
<meta property="og:url" content="${e(spotUrl)}">
<meta property="og:locale" content="${localeMap[l] || 'en_US'}">
<meta property="og:site_name" content="Travel-ID">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDesc}">
<meta name="twitter:image" content="${e(ogImage)}">
<link rel="canonical" href="${e(spotUrl)}">
<meta http-equiv="refresh" content="0; url=${e(appUrl)}">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 24px auto; padding: 16px; color: #1F2937; }
  h1 { font-size: 1.6rem; margin-bottom: 4px; }
  .meta { color: #6B7280; font-size: 0.9rem; margin-bottom: 16px; }
  .cta { display: inline-block; background: #E11D2E; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; margin-top: 16px; }
  img { max-width: 100%; border-radius: 12px; margin: 12px 0; }
</style>
</head>
<body>
${spot.coverImage ? `<img src="${e(spot.coverImage)}" alt="${e(spot.name)}">` : ''}
<h1>${catEmoji} ${e(spot.name)}</h1>
<div class="meta">${e(spot.region)} · ${e(spot.category)}</div>
<p>${e(spot.description)}</p>
<a class="cta" href="${e(appUrl)}">Open in Travel-ID →</a>
</body>
</html>`;

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error('renderSpotPage error:', err);
    return res.redirect(302, 'https://travel-id.kr/');
  }
}

module.exports = async function handler(req, res) {
  if (req.query && req.query.render === 'page') return renderSpotPage(req, res);
  return listSpots(req, res);
};
