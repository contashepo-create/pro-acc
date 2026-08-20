let attempts: any[] = [];
let queryError: any = null;
let insertError: any = null;
const inserted: any[] = [];
const db = { from: jest.fn(() => {
  const api: any = {
    select: () => api, or: () => api, gte: () => api, order: async () => ({ data: attempts, error: queryError }),
    insert: async (payload: any) => { inserted.push(payload); return { error: insertError }; },
  };
  return api;
}) };
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { checkRegistrationRateLimit, recordRegistrationAttempt } from '@/lib/rate-limit';

beforeEach(() => { jest.clearAllMocks(); attempts = []; queryError = null; insertError = null; inserted.length = 0; });

describe('registration rate limiter functions', () => {
  test('allows below the limit and blocks at the limit with remaining time', async () => {
    await expect(checkRegistrationRateLimit(' User@Example.com ', '1.2.3.4', { maxAttempts: 2, windowMinutes: 60 })).resolves.toEqual({ allowed: true, remainingMinutes: 0 });
    attempts = [{ created_at: new Date(Date.now() - 10 * 60000).toISOString() }, { created_at: new Date().toISOString() }];
    const result = await checkRegistrationRateLimit('user@example.com', '1.2.3.4', { maxAttempts: 2, windowMinutes: 60 });
    expect(result.allowed).toBe(false);
    expect(result.remainingMinutes).toBeGreaterThanOrEqual(49);
  });

  test('surfaces query failures rather than disabling throttling', async () => {
    queryError = new Error('db');
    await expect(checkRegistrationRateLimit('a@test.com', 'bad).or(injection)')).rejects.toThrow('db');
  });

  test('records normalized email and sanitized IP and surfaces insert errors', async () => {
    await recordRegistrationAttempt(' User@Example.COM ', '1.2.3.4');
    expect(inserted[0]).toEqual({ email: 'user@example.com', ip_address: '1.2.3.4' });
    insertError = new Error('insert');
    await expect(recordRegistrationAttempt('a@test.com', '1.2.3.4')).rejects.toThrow('insert');
  });
});
