let result: any = { data: [], error: null };
const db = { from: jest.fn(() => { const api: any = { select: () => api, eq: () => api, then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) }; return api; }) };
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));
import { assertOpenFiscalPeriod } from '@/lib/fiscal-guard';

beforeEach(() => { result = { data: [], error: null }; });
describe('fiscal preflight fallback branches', () => {
  test('allows legacy lookup errors and companies with no fiscal years', async () => {
    result = { data: null, error: new Error('missing table') };
    await expect(assertOpenFiscalPeriod('c', '2026-01-01')).resolves.toBeUndefined();
    result = { data: [], error: null };
    await expect(assertOpenFiscalPeriod('c', '2026-01-01')).resolves.toBeUndefined();
    result = { data: null, error: null };
    await expect(assertOpenFiscalPeriod('c', '2026-01-01')).resolves.toBeUndefined();
  });
  test('reports no open range and unnamed closed years', async () => {
    result = { data: [{ id: 'y', name: null, start_date: '2025-01-01', end_date: '2025-12-31', status: 'closed' }], error: null };
    await expect(assertOpenFiscalPeriod('c', '2026-01-01')).rejects.toThrow('خارج نطاق');
    await expect(assertOpenFiscalPeriod('c', '2025-01-01')).rejects.toThrow('2025-01-01');
  });
});
