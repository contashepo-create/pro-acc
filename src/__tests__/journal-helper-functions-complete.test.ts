const getNextJournalNumber = jest.fn(async () => 1);
const isUniqueViolation = jest.fn((error: any) => error?.code === '23505');
const assertOpenFiscalPeriod = jest.fn(async () => undefined);
const rpc = jest.fn();
let headerResults: any[] = [];
let accounts: any[] | null = [];
let accountsError: any = null;
let lineInsertError: any = null;
const inserts: Array<{ table: string; payload: any }> = [];

const db = { rpc, from: jest.fn((table: string) => {
  let mode = 'select'; let payload: any;
  const api: any = {
    select: () => api, in: () => api, eq: () => api,
    insert: (value: any) => { mode = 'insert'; payload = value; inserts.push({ table, payload: value }); return api; },
    delete: () => { mode = 'delete'; return api; },
    single: async () => table === 'journal_entries' && mode === 'insert' ? (headerResults.shift() || { data: { id: 'j1' }, error: null }) : { data: null, error: null },
    then: (resolve: any, reject: any) => Promise.resolve(table === 'accounts' ? { data: accounts, error: accountsError } : { data: null, error: table === 'journal_lines' && mode === 'insert' ? lineInsertError : null }).then(resolve, reject),
  };
  return api;
}) };

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));
jest.mock('@/lib/numbering', () => ({ getNextJournalNumber, isUniqueViolation }));
jest.mock('@/lib/fiscal-guard', () => ({ assertOpenFiscalPeriod }));

import { insertJournalHeader, insertJournalLines, getAccountBalanceFromJournal, createJournalEntry } from '@/lib/journal-utils';

beforeEach(() => { jest.clearAllMocks(); headerResults = []; accounts = []; accountsError = null; lineInsertError = null; inserts.length = 0; getNextJournalNumber.mockResolvedValue(1); });

describe('remaining journal helper functions', () => {
  test('inserts a fiscal-validated numbered journal header', async () => {
    await expect(insertJournalHeader('c1', { date: '2026-08-20', type: 'general', description: 'x', created_by: 'u1' })).resolves.toEqual({ data: { id: 'j1' }, error: null });
    expect(assertOpenFiscalPeriod).toHaveBeenCalledWith('c1', '2026-08-20');
    expect(inserts[0].payload).toMatchObject({ company_id: 'c1', number: 1, description: 'x' });
  });

  test('retries unique collisions and returns nonunique/exhausted errors', async () => {
    headerResults = [{ data: null, error: { code: '23505' } }, { data: { id: 'j2' }, error: null }];
    await expect(insertJournalHeader('c1', { date: '2026-08-20', type: 'general' })).resolves.toEqual({ data: { id: 'j2' }, error: null });
    expect(getNextJournalNumber).toHaveBeenCalledTimes(2);
    headerResults = [{ data: null, error: { code: 'other' } }];
    await expect(insertJournalHeader('c1', { date: '2026-08-20', type: 'general' })).resolves.toMatchObject({ data: null, error: { code: 'other' } });
    headerResults = Array.from({ length: 8 }, () => ({ data: null, error: { code: '23505' } }));
    const exhausted = await insertJournalHeader('c1', { date: '2026-08-20', type: 'general' });
    expect(exhausted.error.code).toBe('23505');
  });

  test('gets tenant-scoped account balances and handles errors/context', async () => {
    await expect(getAccountBalanceFromJournal('a1')).rejects.toThrow('companyId');
    rpc.mockResolvedValueOnce({ data: '12.50', error: null });
    await expect(getAccountBalanceFromJournal('a1', 'c1')).resolves.toBe(12.5);
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getAccountBalanceFromJournal('a1', 'c1')).resolves.toBe(0);
    rpc.mockResolvedValueOnce({ data: null, error: new Error('db') });
    await expect(getAccountBalanceFromJournal('a1', 'c1')).rejects.toThrow('db');
  });

  test('rejects malformed, unbalanced, same-sided and unresolved journal lines', async () => {
    const base = (a: any, b: any) => [{ journal_entry_id: 'j', account_id: 'a1', ...a }, { journal_entry_id: 'j', account_id: 'a2', ...b }];
    expect((await insertJournalLines('c1', [])).error).toBeTruthy();
    for (const lines of [
      base({ debit: NaN, credit: 0 }, { debit: 0, credit: 1 }),
      base({ debit: -1, credit: 0 }, { debit: 0, credit: 1 }),
      base({ debit: 0, credit: 0 }, { debit: 0, credit: 1 }),
      base({ debit: 1, credit: 1 }, { debit: 0, credit: 2 }),
      base({ debit: 1.001, credit: 0 }, { debit: 0, credit: 1.001 }),
      base({ debit: 1, credit: 0 }, { debit: 0, credit: 1.001 }),
    ]) expect((await insertJournalLines('c1', lines)).error).toBeTruthy();
    expect((await insertJournalLines('c1', base({ debit: 2, credit: 0 }, { debit: 0, credit: 1 }))).error?.message).toContain('غير متزن');
    expect((await insertJournalLines('c1', [
      { journal_entry_id: 'j', account_id: 'a1', debit: 1, credit: 0 },
      { journal_entry_id: 'j', account_id: 'a1', debit: 0, credit: 1 },
    ])).error?.message).toContain('الحساب نفسه');
    accountsError = new Error('accounts');
    await expect(insertJournalLines('c1', base({ debit: 1, credit: 0 }, { debit: 0, credit: 1 }))).resolves.toEqual({ error: accountsError });
    accountsError = null; accounts = null;
    expect((await insertJournalLines('c1', base({ debit: 1, credit: 0 }, { debit: 0, credit: 1 }))).error?.message).toContain('العثور');
    accounts = [{ id: 'a1', code: '1000', name: 'Header', is_header: true }, { id: 'a2', code: '2', name: 'B' }];
    expect((await insertJournalLines('c1', base({ debit: 1, credit: 0 }, { debit: 0, credit: 1 }))).error?.message).toContain('رئيسي');
  });

  test('creates a complete journal and executes line mapping callback', async () => {
    accounts = [{ id: 'a1', code: '1001', name: 'A', is_header: false }, { id: 'a2', code: '3001', name: 'B', is_header: false }];
    const result = await createJournalEntry('c1', {
      date: '2026-08-20', type: 'general', description: 'balanced', created_by: 'u1',
      lines: [{ account_id: 'a1', debit: 10, credit: 0, description: 'D', project_id: 'p', contact_id: 'c' }, { account_id: 'a2', debit: 0, credit: 10 }],
    });
    expect(result).toEqual({ journalId: 'j1', error: null });
    const lineInsert = inserts.find((entry) => entry.table === 'journal_lines');
    expect(lineInsert?.payload).toHaveLength(2);
    expect(lineInsert?.payload[0]).toMatchObject({ journal_entry_id: 'j1', account_code: '1001' });
    headerResults = [{ data: null, error: null }];
    const missingHeader = await createJournalEntry('c1', { date: '2026-08-20', type: 'general', description: 'x', lines: [{ account_id: 'a1', debit: 1, credit: 0 }, { account_id: 'a2', debit: 0, credit: 1 }] });
    expect(missingHeader.error).toBeTruthy();
    lineInsertError = new Error('lines');
    const failed = await createJournalEntry('c1', {
      date: '2026-08-20', type: 'general', description: 'balanced',
      lines: [{ account_id: 'a1', debit: 10, credit: 0 }, { account_id: 'a2', debit: 0, credit: 10 }],
    });
    expect(failed.error).toBe(lineInsertError);
  });
});
