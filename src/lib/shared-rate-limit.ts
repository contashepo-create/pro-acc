import { errorText } from './errors';
import { getSupabase } from '@/lib/supabase-client';

export interface SharedRateLimitConfig {
  /** Rolling window length in milliseconds. */
  windowMs: number;
  /** Maximum hits per window for the key. */
  max: number;
}

export interface SharedRateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest hit leaves the window (only when blocked). */
  retryAfterSeconds: number;
}

const sb = () => getSupabase();

/**
 * Authoritative cross-instance rate limit (the in-memory limiter is the fast
 * path; this store is the share every serverless instance counts against).
 *
 * The DB hit is a single atomic `INSERT ... ON CONFLICT DO UPDATE` (see
 * migration 077), so concurrent requests cannot over-allocate the budget.
 *
 * Failure policy: the rate store is defense-in-depth on top of the auth and
 * permission checks that already fail closed on every route. A rate-store
 * outage must not take every business route down with it, so an RPC failure
 * fails OPEN (logged loudly) rather than returning 429s for nothing.
 */
export async function hitSharedRateLimit(
  key: string,
  { windowMs, max }: SharedRateLimitConfig
): Promise<SharedRateLimitResult> {
  const s = sb();
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await s.rpc('hit_rate_limit', {
      p_key: key,
      p_window_ms: windowMs,
      p_max: max,
    }));
  } catch (err) {
    console.error('Shared rate limit store unavailable (failing open):', err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (error) {
    const detail = errorText(error) || String(error);
    console.error('Shared rate limit store unavailable (failing open):', detail);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const row = data as { allowed?: unknown; retry_after_seconds?: unknown } | null;
  if (!row || typeof row.allowed !== 'boolean') {
    console.error('Shared rate limit store returned an unexpected payload:', data);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: row.allowed,
    retryAfterSeconds: Number(row.retry_after_seconds) || 0,
  };
}
