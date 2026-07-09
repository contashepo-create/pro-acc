import { createClient } from '@supabase/supabase-js';

function clean(s: string): string {
  return (s || '').replace(/^\uFEFF/, '').trim();
}

let _client: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!_client) {
    const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
