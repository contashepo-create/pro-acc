let queryData: any = [];
let queryError: any = null;
let singleResult: any = { data: null, error: null };
const db = { from: jest.fn(() => { const api: any = {
  select: () => api, or: () => api, eq: () => api, gte: () => api,
  order: async () => ({ data: queryData, error: queryError }),
  insert: () => api, single: async () => singleResult,
}; return api; }) };
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));
import { sanitizeEmailForFilter, checkRateLimit, checkPasswordResetRateLimit, recordPasswordResetRequest, checkRegistrationRateLimit } from '@/lib/rate-limit';

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
    queryData = [{}, {}, {}];
    await expect(checkPasswordResetRateLimit('a@b.com', '1.2.3.4')).resolves.toEqual({ allowed: false, remainingMinutes: 15 });
    queryData = [];
    await expect(checkPasswordResetRateLimit('a@b.com', '1.2.3.4', { maxRequests: 0, windowMinutes: 0 })).resolves.toMatchObject({ allowed: false, remainingMinutes: 1 });
  });
  test('records null ids and surfaces record errors', async () => {
    await expect(recordPasswordResetRequest(' A@B.COM ', '1.2.3.4')).resolves.toBeNull();
    singleResult = { data: null, error: new Error('insert') };
    await expect(recordPasswordResetRequest('a@b.com', '1.2.3.4')).rejects.toThrow('insert');
  });
  test('handles registration null data and missing oldest timestamp', async () => {
    queryData = null;
    await expect(checkRegistrationRateLimit('a@b.com', '1.2.3.4')).resolves.toEqual({ allowed: true, remainingMinutes: 0 });
    queryData = [{}, {}, {}, {}, {}];
    await expect(checkRegistrationRateLimit('a@b.com', '1.2.3.4')).resolves.toEqual({ allowed: false, remainingMinutes: 60 });
    queryData = [];
    await expect(checkRegistrationRateLimit('a@b.com', '1.2.3.4', { maxAttempts: 0, windowMinutes: 0 })).resolves.toMatchObject({ allowed: false, remainingMinutes: 1 });
  });
});
