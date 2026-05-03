// Public client config: Google Maps key + Google OAuth Client ID + canonical site URL.
// Travel-ID uses Google Maps as the sole map provider (Naver Maps does not
// cover Indonesia/Malaysia). All values returned here are safe to expose to
// the browser — restrict the Maps key with HTTP referrer rules in Google Cloud.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  // PUBLIC_SITE_URL is the canonical origin used in OG tags, hreflang, share
  // links, and sitemap entries. Falls back to the request host so previews work.
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'travel-id.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const siteUrl = process.env.PUBLIC_SITE_URL || (proto + '://' + host);
  res.json({
    googleKey: process.env.GOOGLE_MAPS_API_KEY || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    siteUrl,
  });
};
