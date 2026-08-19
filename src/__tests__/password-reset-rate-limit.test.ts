/**
 * Tests for password-reset rate limiting (lib/rate-limit.ts).
 */
let capturedFilter = '';
let mockData: any[] | null = [];
let mockError: any = null;

jest.mock('../lib/supabase-client', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        or: (filter: string) => {
          capturedFilter = filter;
          return { gte: () => ({ order: () => Promise.resolve({ data: mockData, error: mockError }) }) };
        },
      }),
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'req-1' }, error: null }) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

import {
  checkPasswordResetRateLimit,
  recordPasswordResetRequest,
  markPasswordResetRequest,
} from '../lib/rate-limit';

describe('checkPasswordResetRateLimit', () => {
  beforeEach(() => {
    capturedFilter = '';
    mockData = [];
    mockError = null;
  });

  test('allows requests under the limit', async () => {
    mockData = [{ created_at: new Date(Date.now() - 60000).toISOString() }];
    const r = await checkPasswordResetRateLimit('user@test.com', '10.0.0.1');
    expect(r.allowed).toBe(true);
  });

  test('blocks when requests reach the limit', async () => {
    mockData = [
      { created_at: new Date(Date.now() - 120000).toISOString() },
      { created_at: new Date(Date.now() - 60000).toISOString() },
      { created_at: new Date(Date.now() - 30000).toISOString() },
    ];
    const r = await checkPasswordResetRateLimit('user@test.com', '10.0.0.1');
    expect(r.allowed).toBe(false);
    expect(r.remainingMinutes).toBeGreaterThan(0);
  });

  test('custom maxRequests is honored', async () => {
    mockData = [{ created_at: new Date().toISOString() }];
    const r = await checkPasswordResetRateLimit('user@test.com', '10.0.0.1', { maxRequests: 1 });
    expect(r.allowed).toBe(false);
  });

  test('sanitizes IP to prevent filter injection in the or() string', async () => {
    await checkPasswordResetRateLimit('a@b.com', '1.2.3.4).or(email.eq.hack)');
    expect(capturedFilter).toContain('ip_address.eq.unknown');
    expect(capturedFilter).not.toContain('hack');
  });

  test('fails closed on DB error so an outage cannot disable throttling', async () => {
    mockError = new Error('db down');
    mockData = null;
    await expect(checkPasswordResetRateLimit('user@test.com', '10.0.0.1')).rejects.toThrow('db down');
  });
});

describe('recordPasswordResetRequest', () => {
  test('records a row and returns its id', async () => {
    const id = await recordPasswordResetRequest('User@Test.com', '10.0.0.1');
    expect(id).toBe('req-1');
  });
});

describe('markPasswordResetRequest', () => {
  test('does not throw when updating status', async () => {
    await expect(markPasswordResetRequest('req-1', 'delivered')).resolves.toBeUndefined();
    await expect(markPasswordResetRequest(null, 'failed')).resolves.toBeUndefined();
  });
});
