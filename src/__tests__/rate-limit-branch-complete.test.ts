let queryData: unknown[] | null = [];
let queryError: Error | null = null;
let singleResult: { data: unknown; error: unknown } = { data: null, error: null };
const db = { from: jest.fn(() => { const api = {
  select: () => api, or: () => api, eq: () => api, gte: () => api,
  order: async () => ({ data: queryData, error: queryError }),
  insert: () => api, single: async () => singleResult,
}; return api; }) };
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));
import { sanitizeEmailForFilter, checkRateLimit, checkPasswordResetRateLimit, recordPasswordResetRequest, markPasswordResetRequest, checkRegistrationRateLimit } from '@/lib/rate-limit';

beforeEach(() => { jest.clearAllMocks(); queryData = []; queryError = null; singleResult = { data: null, error: null }; });
describe('remaining rate limit branches', () => {
  test('uses sentinel for empty email and truncates surviving addresses', () => {
    expect(sanitizeEmailForFilter('')).toBe('invalid-email@example.invalid');
    expect(sanitizeEmailForFilter('!')).toBe('invalid-email@example.invalid');
    expect(sanitizeEmailForFilter(`A@B.COM${'x'.repeat(300)}`)).toHaveLength(254);
  });
  test('handles null login attempts and blocked rows lacking timestamps', async () => {
    queryData = null;
    await expect(checkRateLimit('a@b.com', '1.2.3.4')).resolves.toEqual({ allowed: true, remainingMinutes: 0 });
    queryData = Array.from({ length: 5 }, () => ({}));
    await expect(checkRateLimit('a@b.com', '1.2.3.4')).resolves.toEqual({ allowed: true, remainingMinutes: 0 });
  });
  test('handles null/reset rows, missing oldest timestamp and explicit zero options', async () => {
    queryData = null;
    await expect(checkPasswordResetRateLimit('a@b.com', '1.2.3.4')).resolves.toEqual({ allowed: true, remainingMinutes: 0 });
    queryData = Array.from({ length: 3 }, () => ({ created_at: new Date(Date.now() - 60_000).toISOString() }));
    expect((await checkPasswordResetRateLimit('a@b.com', '1.2.3.4')).remainingMinutes).toBeGreaterThan(0);
    queryData = [];
    await expect(checkPasswordResetRateLimit('a@b.com', '1.2.3.4', { maxRequests: 0, windowMinutes: 0 })).resolves.toEqual({ allowed: true, remainingMinutes: 0 });
  });
  test('records null ids and surfaces record errors', async () => {
    await expect(recordPasswordResetRequest(' A@B.COM ', '1.2.3.4')).resolves.toBeNull();
    singleResult = { data: null, error: new Error('insert') };
    await expect(recordPasswordResetRequest('a@b.com', '1.2.3.4')).rejects.toThrow('insert');
  });
  test('swallows delivery-status update exceptions', async () => {
    db.from.mockImplementationOnce(() => { throw new Error('update'); });
    await expect(markPasswordResetRequest('id', 'failed', 'x')).resolves.toBeUndefined();
  });
  test('handles registration null data and missing oldest timestamp', async () => {
    queryData = null;
    await expect(checkRegistrationRateLimit('a@b.com', '1.2.3.4')).resolves.toEqual({ allowed: true, remainingMinutes: 0 });
    queryData = Array.from({ length: 5 }, () => ({ created_at: new Date(Date.now() - 60_000).toISOString() }));
    expect((await checkRegistrationRateLimit('a@b.com', '1.2.3.4')).remainingMinutes).toBeGreaterThan(0);
    queryData = [];
    await expect(checkRegistrationRateLimit('a@b.com', '1.2.3.4', { maxAttempts: 0, windowMinutes: 0 })).resolves.toEqual({ allowed: true, remainingMinutes: 0 });
  });
});
