const rpc = jest.fn();
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => ({ rpc }) }));
import { getContactBalance, getContactBalances } from '@/lib/contact-utils';

beforeEach(() => jest.clearAllMocks());

describe('contact balance error/default branches', () => {
  test('surfaces RPC errors and rejects nonfinite scalar values', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('db') });
    await expect(getContactBalance('c', 'x')).rejects.toThrow('db');
    rpc.mockResolvedValueOnce({ data: 'not-number', error: null });
    await expect(getContactBalance('c', 'x')).rejects.toThrow('Invalid');
  });
  test('handles empty batches, errors, null rows and filters malformed rows', async () => {
    await expect(getContactBalances('c', [])).resolves.toEqual({});
    rpc.mockResolvedValueOnce({ data: null, error: new Error('batch') });
    await expect(getContactBalances('c', ['x'])).rejects.toThrow('batch');
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getContactBalances('c', ['x'])).resolves.toEqual({});
    rpc.mockResolvedValueOnce({ data: [
      { contact_id: '', balance: 1 }, { contact_id: 'x', balance: 'bad' }, { contact_id: 'ok', balance: '2.5' },
    ], error: null });
    await expect(getContactBalances('c', ['x'])).resolves.toEqual({ ok: 2.5 });
  });
});
