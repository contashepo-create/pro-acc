import { createClient } from '@supabase/supabase-js';

function clean(s: string): string {
  return (s || '').replace(/^\uFEFF/, '').trim();
}

let _client: ReturnType<typeof createClient> | null = null;

/**
 * SERVER-ONLY Supabase client using service_role key
 * This bypasses RLS - make sure you always filter by company_id!
 * 
 * @deprecated Use getServerClient from @/lib/supabase instead
 * This file is kept for backward compatibility
 * 
 * SECURITY: Never use this client on the client-side (browser)
 */
export function getSupabase() {
  if (typeof window !== 'undefined') {
    throw new Error('getSupabase() is server-only! Use createClientClient() for browser');
  }
  
  if (!_client) {
    const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    
    if (!url || !key) {
      throw new Error('Missing Supabase URL or Service Role Key - check env vars');
    }
    
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// Re-export for convenience
export { getServerClient, createServerClient, createClientClient } from './supabase';
