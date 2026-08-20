let primary: any = { data: null, error: null };
let fallback: any = { data: null, error: null };
let transactions: any = { data: [], error: null };
let custodyCalls = 0;
const db = { from: jest.fn((table: string) => {
  const api: any = {
    select: () => api, eq: () => api,
    maybeSingle: async () => table === 'custodies' ? (++custodyCalls === 1 ? primary : fallback) : { data: null, error: null },
    order: async () => transactions,
  };
  return api;
}) };
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { loadCustodyFile, assertFileOpen } from '@/lib/custody';

beforeEach(() => { jest.clearAllMocks(); custodyCalls = 0; primary = { data: null, error: null }; fallback = { data: null, error: null }; transactions = { data: [], error: null }; });

describe('custody file loader callbacks', () => {
  test('rejects both settled and closed files but allows open files', () => {
    expect(() => assertFileOpen({ status: 'settled' })).toThrow();
    expect(() => assertFileOpen({ status: 'closed' })).toThrow();
    expect(() => assertFileOpen({ status: 'open' })).not.toThrow();
  });
  test('classifies deposits, expenses and other movements and computes balances', async () => {
    primary = { data: { id: 'f1', status: 'open', employees: { name: 'Ali' }, projects: { name: 'P' }, banks_safes: { name: 'Safe' } }, error: null };
    transactions = { data: [
      { type: 'open', amount: '100' }, { type: 'addition', amount: '50' },
      { type: 'expense', amount: '40' }, { type: 'return', amount: '10' },
    ], error: null };
    const result = await loadCustodyFile('c1', 'f1');
    expect(result).toMatchObject({ employee_name: 'Ali', project_name: 'P', bank_name: 'Safe', total_received: 150, total_expenses: 40, remaining_amount: 110, computed_status: 'partially_settled' });
    expect(result.deposits).toHaveLength(2);
    expect(result.expenses).toHaveLength(1);
    expect(result.other).toHaveLength(1);
  });

  test('uses stored total_received and tolerates transaction lookup errors', async () => {
    primary = { data: { id: 'f1', status: 'open', total_received: '25', amount: '10' }, error: null };
    transactions = { data: null, error: new Error('transactions') };
    await expect(loadCustodyFile('c1', 'f1')).resolves.toMatchObject({ total_received: 25, total_expenses: 0, remaining_amount: 25, computed_status: 'open' });
    custodyCalls = 0; transactions = { data: null, error: null };
    await expect(loadCustodyFile('c1', 'f1')).resolves.toMatchObject({ transactions: [] });
  });

  test('clamps overspent remaining balances and defaults malformed transaction amounts', async () => {
    primary = { data: { id: 'f1', status: 'open', amount: null }, error: null };
    transactions = { data: [{ type: 'deposit', amount: 'bad' }, { type: 'expense', amount: 10 }, { type: 'expense', amount: 'bad' }], error: null };
    await expect(loadCustodyFile('c1', 'f1')).resolves.toMatchObject({ total_received: 0, total_expenses: 10, remaining_amount: 0 });
  });

  test('uses fallback rows, stored opening amount, and settled status', async () => {
    primary = { data: null, error: new Error('join missing') };
    fallback = { data: { id: 'f1', status: 'closed', amount: '75' }, error: null };
    const result = await loadCustodyFile('c1', 'f1');
    expect(result).toMatchObject({ total_received: 75, total_expenses: 0, remaining_amount: 0, computed_status: 'settled', is_closed: true });
  });

  test('returns null for missing files and surfaces fallback errors', async () => {
    await expect(loadCustodyFile('c1', 'none')).resolves.toBeNull();
    primary = { data: null, error: new Error('join') }; fallback = { data: null, error: new Error('db') };
    await expect(loadCustodyFile('c1', 'x')).rejects.toThrow('db');
  });
});
