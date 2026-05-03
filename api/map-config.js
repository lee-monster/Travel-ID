// Public client config: Google Maps key + OAuth Client ID + Supabase public
// credentials + canonical site URL.
// SUPABASE_ANON_KEY is intentionally exposed; RLS enforces all reads/writes.
// SUPABASE_SERVICE_ROLE_KEY must NEVER appear in this response.
const { getSiteUrl } = require('./_lib/supabase');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.json({
    googleKey: process.env.GOOGLE_MAPS_API_KEY || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseSchema: process.env.SUPABASE_SCHEMA || 'travelid',
    siteUrl: getSiteUrl(req),
  });
};
