import { hitRateLimit, resetRateLimits, READ_LIMIT, WRITE_LIMIT } from '@/lib/memory-rate-limit';

describe('in-memory business-route rate limiter', () => {
  beforeEach(() => resetRateLimits());

  it('allows requests under the limit', () => {
    const limit = { windowMs: 60_000, max: 3 };
    expect(hitRateLimit('u1', limit, 1000).allowed).toBe(true);
    expect(hitRateLimit('u1', limit, 1001).allowed).toBe(true);
    expect(hitRateLimit('u1', limit, 1002).allowed).toBe(true);
  });

  it('blocks the request that exceeds the limit and reports retry-after', () => {
    const limit = { windowMs: 60_000, max: 2 };
    hitRateLimit('u1', limit, 1000);
    hitRateLimit('u1', limit, 2000);
    const third = hitRateLimit('u1', limit, 3000);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('slides the window: old hits expire', () => {
    const limit = { windowMs: 10_000, max: 2 };
    hitRateLimit('u1', limit, 1000);
    hitRateLimit('u1', limit, 2000);
    expect(hitRateLimit('u1', limit, 5000).allowed).toBe(false);
    // 11.5s later the first two hits left the window
    expect(hitRateLimit('u1', limit, 12_500).allowed).toBe(true);
  });

  it('periodic sweep removes stale buckets and retains buckets with recent hits', () => {
    const limit = { windowMs: 1_000_000, max: 10 };
    hitRateLimit('stale', limit, 1);
    expect(hitRateLimit('recent', limit, 400_000).allowed).toBe(true);
    hitRateLimit('recent', limit, 699_000);
    // More than the sweep interval; the recent bucket still has a surviving hit.
    expect(hitRateLimit('fresh', limit, 701_000).allowed).toBe(true);
    expect(hitRateLimit('stale', limit, 701_001).allowed).toBe(true);
  });

  it('keys are isolated from each other', () => {
    const limit = { windowMs: 60_000, max: 1 };
    expect(hitRateLimit('user:a:w', limit, 1000).allowed).toBe(true);
    expect(hitRateLimit('user:b:w', limit, 1000).allowed).toBe(true);
    expect(hitRateLimit('user:a:w', limit, 1001).allowed).toBe(false);
  });

  it('read budget is larger than write budget', () => {
    expect(READ_LIMIT.max).toBeGreaterThan(WRITE_LIMIT.max);
  });
});
