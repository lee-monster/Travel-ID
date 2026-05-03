// Shared Notion client + helpers for Travel-ID API routes.
// All endpoints read/write the Notion databases configured via NOTION_DB_TRAVEL
// (spots) and NOTION_DB_USERS (users + bookmarks).
const { Client } = require('@notionhq/client');

let _client = null;
function notion() {
  if (_client) return _client;
  const token = process.env.NOTION_TOKEN_TRAVEL;
  if (!token) throw new Error('NOTION_TOKEN_TRAVEL not configured');
  _client = new Client({ auth: token });
  return _client;
}

const SPOTS_DB = process.env.NOTION_DB_TRAVEL;
const USERS_DB = process.env.NOTION_DB_USERS;

// ─── Property accessors (defensive against missing fields) ───
function getTitle(prop) {
  if (!prop || !prop.title) return '';
  return prop.title.map((t) => t.plain_text).join('');
}
function getRichText(prop) {
  if (!prop || !prop.rich_text) return '';
  return prop.rich_text.map((t) => t.plain_text).join('');
}
function getNumber(prop) {
  return prop && typeof prop.number === 'number' ? prop.number : null;
}
function getCheckbox(prop) {
  return !!(prop && prop.checkbox);
}
function getSelectName(prop) {
  return prop && prop.select && prop.select.name ? prop.select.name : '';
}
function getMultiSelectNames(prop) {
  if (!prop || !prop.multi_select) return [];
  return prop.multi_select.map((o) => o.name);
}
function getUrl(prop) {
  return prop && prop.url ? prop.url : '';
}
function getFiles(prop) {
  if (!prop || !prop.files) return [];
  return prop.files.map((f) => (f.external && f.external.url) || (f.file && f.file.url) || '').filter(Boolean);
}

// ─── Spot row → API JSON ───
// Multi-language fields fall back: <lang> → en (Description / Description_en) → empty.
function spotFromPage(page, lang) {
  const p = page.properties || {};
  const langKey = (lang || 'en').toLowerCase();
  const nameByLang = {
    en: getTitle(p.Name),
    id: getRichText(p.Name_id),
    ms: getRichText(p.Name_ms),
    ko: getRichText(p.Name_ko),
    zh: getRichText(p.Name_zh),
    ja: getRichText(p.Name_ja),
    ar: getRichText(p.Name_ar),
  };
  const descByLang = {
    en: getRichText(p.Description),
    id: getRichText(p.Description_id),
    ms: getRichText(p.Description_ms),
    ko: getRichText(p.Description_ko),
    zh: getRichText(p.Description_zh),
    ja: getRichText(p.Description_ja),
    ar: getRichText(p.Description_ar),
  };
  const photos = getFiles(p.Photos);
  return {
    id: page.id,
    name: nameByLang[langKey] || nameByLang.en || '',
    nameEn: nameByLang.en,
    nameId: nameByLang.id,
    nameMs: nameByLang.ms,
    nameKo: nameByLang.ko,
    nameZh: nameByLang.zh,
    nameJa: nameByLang.ja,
    nameAr: nameByLang.ar,
    description: descByLang[langKey] || descByLang.en || '',
    category: getSelectName(p.Category),
    region: getSelectName(p.Region),
    lat: getNumber(p.Latitude),
    lng: getNumber(p.Longitude),
    address: getRichText(p.Address),
    coverImage: getUrl(p.CoverImage) || photos[0] || '',
    photos: photos,
    instagram: getRichText(p.Instagram),
    website: getUrl(p.Website),
    googleMapLink: getUrl(p.GoogleMapLink),
    rating: getNumber(p.Rating) || 0,
    featured: getCheckbox(p.Featured),
    halal: getCheckbox(p.Halal),
    prayerRoom: getCheckbox(p.PrayerRoom),
    vegFriendly: getCheckbox(p.VegFriendly),
    entryFeeIDR: getNumber(p.EntryFeeIDR),
    bestTimeToVisit: getSelectName(p.BestTimeToVisit),
    localTips: getRichText(p.LocalTips),
    openingHours: getRichText(p.OpeningHours),
    tags: getMultiSelectNames(p.Tags),
    submittedBy: getRichText(p.SubmittedBy),
    createdAt: page.created_time,
  };
}

// ─── User row → JSON (used by auth/bookmarks) ───
function userFromPage(page) {
  const p = page.properties || {};
  let bookmarks = { want_to_visit: [], interested: [] };
  let plans = [];
  try {
    const raw = getRichText(p.Bookmarks);
    if (raw) bookmarks = JSON.parse(raw);
  } catch (_) {}
  try {
    const raw = getRichText(p.Plans);
    if (raw) plans = JSON.parse(raw);
  } catch (_) {}
  return {
    id: page.id,
    email: getTitle(p.Email),
    googleId: getRichText(p.GoogleId),
    name: getRichText(p.Name),
    picture: getUrl(p.Picture),
    locale: getSelectName(p.Locale),
    bookmarks,
    plans,
  };
}

// ─── Find user by Google ID (used by /api/auth/google) ───
async function findUserByGoogleId(googleId) {
  const res = await notion().databases.query({
    database_id: USERS_DB,
    filter: { property: 'GoogleId', rich_text: { equals: googleId } },
    page_size: 1,
  });
  return res.results.length ? userFromPage(res.results[0]) : null;
}

async function findUserByEmail(email) {
  const res = await notion().databases.query({
    database_id: USERS_DB,
    filter: { property: 'Email', title: { equals: email } },
    page_size: 1,
  });
  return res.results.length ? userFromPage(res.results[0]) : null;
}

async function createUser({ email, googleId, name, picture, locale }) {
  const page = await notion().pages.create({
    parent: { database_id: USERS_DB },
    properties: {
      Email: { title: [{ text: { content: email } }] },
      GoogleId: { rich_text: [{ text: { content: googleId } }] },
      Name: { rich_text: [{ text: { content: name || '' } }] },
      Picture: picture ? { url: picture } : { url: null },
      Locale: locale ? { select: { name: locale } } : undefined,
      LastLogin: { date: { start: new Date().toISOString().slice(0, 10) } },
      Bookmarks: { rich_text: [{ text: { content: JSON.stringify({ want_to_visit: [], interested: [] }) } }] },
      Plans: { rich_text: [{ text: { content: '[]' } }] },
    },
  });
  return userFromPage(page);
}

async function updateUserBookmarks(userId, bookmarks) {
  await notion().pages.update({
    page_id: userId,
    properties: {
      Bookmarks: { rich_text: [{ text: { content: JSON.stringify(bookmarks) } }] },
    },
  });
}

async function touchUserLogin(userId) {
  try {
    await notion().pages.update({
      page_id: userId,
      properties: { LastLogin: { date: { start: new Date().toISOString().slice(0, 10) } } },
    });
  } catch (_) {}
}

// Resolve the canonical public site URL from a request.
// Order: PUBLIC_SITE_URL env > x-forwarded-host > request host > vercel.app fallback.
function getSiteUrl(req) {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const host = (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'travel-id.vercel.app';
  const proto = (req && req.headers && req.headers['x-forwarded-proto']) || 'https';
  return proto + '://' + host;
}

module.exports = {
  notion,
  SPOTS_DB,
  USERS_DB,
  spotFromPage,
  userFromPage,
  findUserByGoogleId,
  findUserByEmail,
  createUser,
  updateUserBookmarks,
  touchUserLogin,
  getSiteUrl,
};
