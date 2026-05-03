// Shared Supabase clients for serverless functions.
// - getSupaPublic(): anon key + RLS-enforced. Use for read endpoints that
//   should only see published rows / the caller's own data after auth.
// - getSupaAdmin(): service_role key, bypasses RLS. Use for admin/cleanup,
//   migration, server-side writes that need to override RLS.
//
// SCHEMA NOTE: Travel-ID co-tenants the TravelKo Supabase project, isolating
// all its tables in a dedicated `travelid` PostgreSQL schema. The schema is
// configurable via SUPABASE_SCHEMA env (default 'travelid'). The schema must
// also be added to Project Settings → API → Exposed schemas in Supabase.
//
// SUPABASE_SERVICE_ROLE_KEY must NEVER be sent to the browser. Only API
// routes (server-side) read it.
const { createClient } = require('@supabase/supabase-js');

const SCHEMA = process.env.SUPABASE_SCHEMA || 'travelid';

let publicClient = null;
let adminClient = null;

function getSupaPublic() {
  if (publicClient) return publicClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY not configured');
  publicClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: SCHEMA },
  });
  return publicClient;
}

function getSupaAdmin() {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: SCHEMA },
  });
  return adminClient;
}

// Resolve the canonical public site URL from a request.
// Order: PUBLIC_SITE_URL env > x-forwarded-host > request host > vercel.app fallback.
function getSiteUrl(req) {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const host = (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'travel-id.vercel.app';
  const proto = (req && req.headers && req.headers['x-forwarded-proto']) || 'https';
  return proto + '://' + host;
}

module.exports = { getSupaPublic, getSupaAdmin, getSiteUrl };
