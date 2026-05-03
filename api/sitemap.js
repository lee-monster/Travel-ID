// Travel-ID sitemap generator (Notion-backed).
// Lists base/lang URLs and one entry per published spot × language.
const { notion, SPOTS_DB } = require('./_lib/notion');

const BASE_URL = 'https://travel-id.kr';
const LANGS = ['en', 'id', 'ms', 'ko', 'zh', 'ja', 'ar'];
const CATEGORIES = [
  'beach','temple','cultural','volcano','nature','diving',
  'food','cafe','shopping','nightlife','museum','adventure','wellness',
];
const REGIONS = [
  // Indonesia
  'Bali','Jakarta','Yogyakarta','Bandung','Lombok','Komodo','Bromo',
  'Borobudur','Surabaya','Medan','Raja Ampat','Sumatra','Sulawesi','Kalimantan',
  // Malaysia
  'Kuala Lumpur','Penang','Langkawi','Melaka','Sabah','Sarawak',
  'Cameron Highlands','Johor Bahru','Ipoh','Putrajaya',
];

function escXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function langUrl(path, lang) {
  if (path.indexOf('?') !== -1) return BASE_URL + path + '&lang=' + lang;
  return BASE_URL + path + '?lang=' + lang;
}

module.exports = async function handler(req, res) {
  const now = new Date().toISOString().split('T')[0];

  const basePaths = [{ path: '/', priority: '1.0', changefreq: 'daily' }];
  CATEGORIES.forEach((cat) => {
    basePaths.push({ path: '/?category=' + cat, priority: '0.8', changefreq: 'weekly' });
  });
  REGIONS.forEach((region) => {
    basePaths.push({ path: '/?region=' + encodeURIComponent(region), priority: '0.7', changefreq: 'weekly' });
  });

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  xml += ' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

  basePaths.forEach((bp) => {
    LANGS.forEach((lang) => {
      xml += '  <url>\n';
      xml += '    <loc>' + escXml(langUrl(bp.path, lang)) + '</loc>\n';
      xml += '    <lastmod>' + now + '</lastmod>\n';
      xml += '    <changefreq>' + bp.changefreq + '</changefreq>\n';
      xml += '    <priority>' + bp.priority + '</priority>\n';
      LANGS.forEach((altLang) => {
        xml += '    <xhtml:link rel="alternate" hreflang="' + altLang + '" href="' + escXml(langUrl(bp.path, altLang)) + '"/>\n';
      });
      xml += '    <xhtml:link rel="alternate" hreflang="x-default" href="' + escXml(BASE_URL + bp.path) + '"/>\n';
      xml += '  </url>\n';
    });
  });

  // Append one block per published spot per language
  try {
    let cursor;
    do {
      const result = await notion().databases.query({
        database_id: SPOTS_DB,
        filter: { property: 'Published', checkbox: { equals: true } },
        page_size: 100,
        start_cursor: cursor,
      });
      result.results.forEach((page) => {
        const spotPath = '/spot/' + page.id;
        const lastmod = (page.last_edited_time || now).split('T')[0];
        LANGS.forEach((lang) => {
          const url = BASE_URL + spotPath + '?lang=' + lang;
          xml += '  <url>\n';
          xml += '    <loc>' + escXml(url) + '</loc>\n';
          xml += '    <lastmod>' + lastmod + '</lastmod>\n';
          xml += '    <changefreq>weekly</changefreq>\n';
          xml += '    <priority>0.6</priority>\n';
          LANGS.forEach((altLang) => {
            xml += '    <xhtml:link rel="alternate" hreflang="' + altLang + '" href="' + escXml(BASE_URL + spotPath + '?lang=' + altLang) + '"/>\n';
          });
          xml += '    <xhtml:link rel="alternate" hreflang="x-default" href="' + escXml(BASE_URL + spotPath) + '"/>\n';
          xml += '  </url>\n';
        });
      });
      cursor = result.has_more ? result.next_cursor : null;
    } while (cursor);
  } catch (err) {
    console.error('sitemap notion error:', err.message);
  }

  xml += '</urlset>';

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};
