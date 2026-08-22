/**
 * Unit tests for the shared (DB-backed) rate limiter — the authoritative
 * cross-instance budget that complements the in-memory fast path.
 */
import { hitSharedRateLimit } from '@/lib/shared-rate-limit';

let rpcImpl: (name: string, params: any) => Promise<{ data: any; error: any }> = async () => ({ data: null, error: null });

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => ({
    rpc: (name: string, params: any) => rpcImpl(name, params),
  }),
}));

describe('hitSharedRateLimit', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  test('passes through an allowed hit with zero retry', async () => {
    rpcImpl = async () => ({ data: { allowed: true, retry_after_seconds: 0 }, error: null });
    await expect(hitSharedRateLimit('user:u1:r', { windowMs: 60_000, max: 600 }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logError).not.toHaveBeenCalled();
  });

  test('passes through a blocked hit with its retry-after', async () => {
    rpcImpl = async (name, params) => {
      expect(name).toBe('hit_rate_limit');
      expect(params).toEqual({ p_key: 'user:u1:w', p_window_ms: 60_000, p_max: 150 });
      return { data: { allowed: false, retry_after_seconds: 42 }, error: null };
    };
    await expect(hitSharedRateLimit('user:u1:w', { windowMs: 60_000, max: 150 }))
      .resolves.toEqual({ allowed: false, retryAfterSeconds: 42 });
    expect(logError).not.toHaveBeenCalled();
  });

  test('coerces a missing retry_after_seconds to 0', async () => {
    rpcImpl = async () => ({ data: { allowed: true }, error: null });
    await expect(hitSharedRateLimit('k', { windowMs: 1000, max: 1 }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  test('fails open (allowing) when the store returns an RPC error with a message', async () => {
    rpcImpl = async () => ({ data: null, error: { message: 'relation "rate_limit_buckets" does not exist' } });
    await expect(hitSharedRateLimit('k', { windowMs: 1000, max: 1 }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logError).toHaveBeenCalled();
    expect(logError.mock.calls[0].join(' ')).toContain('relation "rate_limit_buckets" does not exist');
  });

  test('fails open when the RPC error carries no message', async () => {
    rpcImpl = async () => ({ data: null, error: {} });
    await expect(hitSharedRateLimit('k', { windowMs: 1000, max: 1 }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logError).toHaveBeenCalled();
  });

  test('fails open when the RPC error is a bare string', async () => {
    rpcImpl = async () => ({ data: null, error: 'store down' });
    await expect(hitSharedRateLimit('k', { windowMs: 1000, max: 1 }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logError).toHaveBeenCalled();
    expect(logError.mock.calls[0].join(' ')).toContain('store down');
  });

  test('fails open when the payload is null', async () => {
    rpcImpl = async () => ({ data: null, error: null });
    await expect(hitSharedRateLimit('k', { windowMs: 1000, max: 1 }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logError).toHaveBeenCalled();
  });

  test('fails open when the payload is not a boolean decision', async () => {
    rpcImpl = async () => ({ data: { allowed: 'yes' }, error: null });
    await expect(hitSharedRateLimit('k', { windowMs: 1000, max: 1 }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logError).toHaveBeenCalled();
  });

  test('fails open when the client throws (e.g. misconfigured client)', async () => {
    rpcImpl = async () => { throw new Error('client exploded'); };
    await expect(hitSharedRateLimit('k', { windowMs: 1000, max: 1 }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(logError).toHaveBeenCalled();
  });
});
