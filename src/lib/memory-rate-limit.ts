/**
 * In-memory sliding-window rate limiter for API business routes.
 *
 * The auth routes already have a DB-backed limiter (`rate-limit.ts`, 5
 * attempts / 15 min). This module adds a lightweight per-instance limiter
 * for the remaining ~220 business endpoints so a single client cannot
 * brute-force resource ids or flood the database.
 *
 * NOTE: state is per server instance (fine as a baseline on a single Node
 * deployment; on serverless it still bounds each instance). Swap for a
 * Redis-backed implementation if horizontal scaling requires shared state.
 */

interface Bucket {
  /** Timestamps (ms) of requests inside the current window. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// Defaults: generous enough for a busy accountant UI, tight enough to stop floods.
export const READ_LIMIT = { windowMs: 60_000, max: 600 };
export const WRITE_LIMIT = { windowMs: 60_000, max: 150 };

let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const cutoff = now - Math.max(READ_LIMIT.windowMs, WRITE_LIMIT.windowMs);
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest hit leaves the window (only when blocked). */
  retryAfterSeconds: number;
}

/**
 * Record a hit for `key` and report whether it stays within `max` hits per
 * `windowMs`.
 */
export function hitRateLimit(
  key: string,
  { windowMs, max }: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  const windowStart = now - windowMs;
  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  if (bucket.hits.length >= max) {
    const oldest = bucket.hits[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  bucket.hits.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}
