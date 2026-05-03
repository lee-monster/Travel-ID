#!/usr/bin/env node
/**
 * One-time migration: pull all spots from Notion → insert into Supabase.
 *
 * Usage:
 *   1. npm install
 *   2. cp .env.example .env.local  (fill in NOTION_TOKEN_TRAVEL,
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *   3. node -r dotenv/config scripts/migrate-notion-to-supabase.js
 *      dotenv_config_path=.env.local
 *
 * Idempotent: spots are upserted on lower(name).
 * Translations are upserted on (spot_id, lang).
 */
const { Client } = require('@notionhq/client');
const { createClient } = require('@supabase/supabase-js');

const NOTION_TOKEN = process.env.NOTION_TOKEN_TRAVEL;
const NOTION_DB    = process.env.NOTION_DB_TRAVEL || '10e3dd6ce89841e98a211c5ac4fd2449';
const SUPA_URL     = process.env.SUPABASE_URL;
const SUPA_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!NOTION_TOKEN || !SUPA_URL || !SUPA_KEY) {
  console.error('Missing one of: NOTION_TOKEN_TRAVEL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const SCHEMA = process.env.SUPABASE_SCHEMA || 'travelid';

const notion = new Client({ auth: NOTION_TOKEN });
const supa = createClient(SUPA_URL, SUPA_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: SCHEMA },
});

const LANGS = ['en', 'id', 'ms', 'ko', 'zh', 'ja', 'ar'];

// Region → country mapping (Indonesia spots vs Malaysia spots)
const ID_REGIONS = new Set([
  'Bali','Jakarta','Yogyakarta','Bandung','Lombok','Komodo','Surabaya','Medan',
  'Bromo','Borobudur','Raja Ampat','Sumatra','Sulawesi','Kalimantan',
]);
const MY_REGIONS = new Set([
  'Kuala Lumpur','Penang','Langkawi','Melaka','Sabah','Sarawak',
  'Cameron Highlands','Johor Bahru','Ipoh','Putrajaya',
]);
function inferCountry(region) {
  if (ID_REGIONS.has(region)) return 'ID';
  if (MY_REGIONS.has(region)) return 'MY';
  return 'ID';
}

const text = (p) => (p && p.rich_text ? p.rich_text.map(t => t.plain_text).join('') : '');
const title = (p) => (p && p.title ? p.title.map(t => t.plain_text).join('') : '');
const num = (p) => (p && typeof p.number === 'number' ? p.number : null);
const cb = (p) => !!(p && p.checkbox);
const sel = (p) => (p && p.select && p.select.name) || null;
const ms = (p) => (p && p.multi_select ? p.multi_select.map(o => o.name) : []);
const url = (p) => (p && p.url) || null;
const files = (p) => (p && p.files ? p.files.map(f => (f.external && f.external.url) || (f.file && f.file.url)).filter(Boolean) : []);

async function fetchAllSpots() {
  const out = [];
  let cursor;
  do {
    const r = await notion.databases.query({
      database_id: NOTION_DB,
      filter: { property: 'Published', checkbox: { equals: true } },
      page_size: 100,
      start_cursor: cursor,
    });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out;
}

async function migrate() {
  console.log('Fetching spots from Notion...');
  const pages = await fetchAllSpots();
  console.log(`Found ${pages.length} published spots.`);

  let inserted = 0;
  let translationsInserted = 0;

  for (const page of pages) {
    const p = page.properties;
    const name = title(p.Name);
    if (!name) { console.warn('Skipping page with no Name:', page.id); continue; }

    const region = sel(p.Region);
    const photos = files(p.Photos);

    const spotRow = {
      name,
      category: sel(p.Category) || 'cultural',
      region,
      country: inferCountry(region),
      latitude: num(p.Latitude),
      longitude: num(p.Longitude),
      address: text(p.Address) || null,
      cover_image: url(p.CoverImage) || photos[0] || null,
      photos,
      tags: ms(p.Tags),
      instagram: text(p.Instagram) || null,
      website: url(p.Website),
      google_map_link: url(p.GoogleMapLink),
      rating: num(p.Rating),
      featured: cb(p.Featured),
      published: cb(p.Published),
      halal: cb(p.Halal),
      prayer_room: cb(p.PrayerRoom),
      veg_friendly: cb(p.VegFriendly),
      entry_fee: num(p.EntryFeeIDR),
      best_time_to_visit: sel(p.BestTimeToVisit),
      local_tips: text(p.LocalTips) || null,
      opening_hours: text(p.OpeningHours) || null,
    };

    // Upsert spot on (lower(name)). We can't onConflict on lower(name) directly,
    // so we look up by case-insensitive name first.
    const { data: existing } = await supa
      .from('spots')
      .select('id')
      .ilike('name', name)
      .maybeSingle();

    let spotId;
    if (existing) {
      spotId = existing.id;
      const { error } = await supa.from('spots').update(spotRow).eq('id', spotId);
      if (error) { console.error('UPDATE failed for', name, error.message); continue; }
      console.log(`  ↻ Updated: ${name}`);
    } else {
      const { data, error } = await supa.from('spots').insert(spotRow).select('id').single();
      if (error) { console.error('INSERT failed for', name, error.message); continue; }
      spotId = data.id;
      inserted++;
      console.log(`  + Inserted: ${name}`);
    }

    // Translations
    const trRows = [];
    const tr = {
      en: { name: title(p.Name),         description: text(p.Description) },
      id: { name: text(p.Name_id),       description: text(p.Description_id) },
      ms: { name: text(p.Name_ms),       description: text(p.Description_ms) },
      ko: { name: text(p.Name_ko),       description: text(p.Description_ko) },
      zh: { name: text(p.Name_zh),       description: text(p.Description_zh) },
      ja: { name: text(p.Name_ja),       description: text(p.Description_ja) },
      ar: { name: text(p.Name_ar),       description: text(p.Description_ar) },
    };
    for (const lang of LANGS) {
      const t = tr[lang];
      if (!t.name && !t.description) continue;
      trRows.push({ spot_id: spotId, lang, name: t.name || null, description: t.description || null });
    }
    if (trRows.length) {
      const { error } = await supa.from('spot_translations').upsert(trRows, { onConflict: 'spot_id,lang' });
      if (error) console.error('Translations failed for', name, error.message);
      else translationsInserted += trRows.length;
    }
  }

  console.log('\nDone.');
  console.log(`  Spots inserted: ${inserted}`);
  console.log(`  Spots updated:  ${pages.length - inserted}`);
  console.log(`  Translations upserted: ${translationsInserted}`);
}

migrate().catch(err => { console.error(err); process.exit(1); });
