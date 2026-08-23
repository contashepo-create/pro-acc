import { getServerClient } from './supabase';
import type { SupabaseLike } from './types';

/**
 * SERVER-ONLY Supabase accessor using the service_role key.
 * This bypasses RLS — always filter by company_id!
 *
 * This module is a thin compatibility alias over `@/lib/supabase`
 * (the single client implementation). Both import paths return the SAME
 * singleton, so there is no duplicated connection/config logic anymore.
 *
 * New code may import `getServerClient` from '@/lib/supabase' directly;
 * existing code and tests that reference '@/lib/supabase-client' keep
 * working unchanged.
 */
export function getSupabase(): SupabaseLike {
  if (typeof window !== 'undefined') {
    throw new Error('getSupabase() is server-only! Use createClientClient() for browser');
  }
  // The real client is structurally a SupabaseLike (verified: its builder
  // chains satisfy the interface); the direct check overflows TS's
  // instantiation-depth limit, so this single boundary uses a cast.
  return getServerClient() as unknown as SupabaseLike;
}

// Re-export the full public API of the canonical module.
export { getServerClient, createServerClient, createClientClient, getClientClient } from './supabase';
