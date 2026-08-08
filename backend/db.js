// Supabase (Postgres) client. Replaces the original file-based lowdb store —
// lowdb wrote to a local JSON file, which doesn't survive on Vercel's
// serverless/read-only filesystem. Every route now reads/writes Supabase
// directly instead.
//
// Uses the SERVICE ROLE key (server-side only, never expose it to the
// frontend) so it bypasses Row Level Security — that's fine here because
// every route in this app already enforces its own auth (requireAuth /
// requireAdmin) before touching the database.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = supabase;
