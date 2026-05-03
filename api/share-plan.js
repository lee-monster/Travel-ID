// /api/share-plan — Save and retrieve shared travel plans (Notion-backed).
//   POST: save a plan, return ShareId
//   GET ?id=<shareId>: retrieve a shared plan
const crypto = require('crypto');
const { notion, getSiteUrl } = require('./_lib/notion');
const { setCors, getUserFromRequest } = require('./_lib/auth');

const SHARED_DB = process.env.NOTION_DB_SHARED_PLANS || '43e9ab1e470d4894a708e8a6a2f513d5';

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET')  return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};

async function handleGet(req, res) {
  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  try {
    const result = await notion().databases.query({
      database_id: SHARED_DB,
      filter: { property: 'ShareId', title: { equals: id } },
      page_size: 1,
    });
    if (!result.results.length) return res.status(404).json({ error: 'Plan not found' });
    const p = result.results[0].properties || {};
    const get = (prop) => (prop && prop.rich_text ? prop.rich_text.map((t) => t.plain_text).join('') : '');
    const title = get(p.PlanTitle);
    const planHtml = get(p.PlanHtml);
    let spotNames = [];
    try {
      const raw = get(p.SpotNames);
      if (raw) spotNames = JSON.parse(raw);
    } catch (_) {}
    return res.status(200).json({
      success: true,
      plan: {
        title,
        days: (p.Days && typeof p.Days.number === 'number') ? p.Days.number : 0,
        budget: (p.Budget && p.Budget.select && p.Budget.select.name) || '',
        style: (p.Style && p.Style.select && p.Style.select.name) || '',
        lang: (p.Lang && p.Lang.select && p.Lang.select.name) || 'en',
        spotNames,
        planHtml,
        sharedAt: result.results[0].created_time,
      },
    });
  } catch (err) {
    console.error('share-plan GET error:', err);
    return res.status(500).json({ error: 'Failed to retrieve plan' });
  }
}

// Notion rich_text caps a single chunk at 2000 chars; split planHtml across
// multiple rich_text chunks so we can store ~60k chars (Notion property limit).
function chunkText(s, size) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push({ text: { content: s.slice(i, i + size) } });
  return out.length ? out : [{ text: { content: '' } }];
}

async function handlePost(req, res) {
  const { title, days, budget, style, spotNames, planHtml, lang } = req.body || {};
  if (!title || !planHtml) return res.status(400).json({ error: 'Missing required fields: title, planHtml' });

  const owner = getUserFromRequest(req);  // optional; anonymous shares allowed

  for (let attempt = 0; attempt < 5; attempt++) {
    const shareId = crypto.randomBytes(4).toString('hex');
    try {
      const props = {
        ShareId:    { title: [{ text: { content: shareId } }] },
        PlanTitle:  { rich_text: chunkText(String(title).slice(0, 200), 200) },
        PlanHtml:   { rich_text: chunkText(String(planHtml).slice(0, 60000), 1900) },
        SpotNames:  { rich_text: chunkText(JSON.stringify(Array.isArray(spotNames) ? spotNames : []), 1900) },
      };
      if (typeof days === 'number') props.Days = { number: days };
      if (budget && ['budget','moderate','luxury'].indexOf(budget) !== -1) props.Budget = { select: { name: budget } };
      if (style && ['relaxed','balanced','packed'].indexOf(style) !== -1) props.Style = { select: { name: style } };
      if (lang && ['en','id','ko','zh','ja'].indexOf(lang) !== -1) props.Lang = { select: { name: lang } };
      if (owner && owner.email) props.Owner = { rich_text: [{ text: { content: owner.email } }] };

      await notion().pages.create({ parent: { database_id: SHARED_DB }, properties: props });

      return res.status(200).json({
        success: true,
        shareId,
        shareUrl: getSiteUrl(req) + '/plan/' + shareId,
      });
    } catch (err) {
      if (/duplicate|already exists/i.test(err.message)) continue;
      console.error('share-plan POST error:', err);
      return res.status(500).json({ error: 'Failed to save shared plan', detail: err.message });
    }
  }
  return res.status(500).json({ error: 'Could not allocate share id' });
}
