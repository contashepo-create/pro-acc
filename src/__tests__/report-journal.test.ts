import {
  loadReportAccounts, loadReportJournalEntries, loadReportJournalLines, resolveLineAccountId,
} from '@/lib/report-journal';
import { mockSupabase } from './mocks';

describe('report line → account resolution', () => {
  test('prefers account_id when it exists on the chart', () => {
    const byId = new Set(['a1']);
    const byCode = new Map([['1110-0001', 'a1']]);
    expect(resolveLineAccountId({ account_id: 'a1', account_code: 'x' }, byId, byCode)).toBe('a1');
  });

  test('returns raw unknown account id or null when neither map resolves', () => {
    expect(resolveLineAccountId({ account_id: 'legacy', account_code: 'none' }, new Set(), new Map())).toBe('legacy');
    expect(resolveLineAccountId({}, new Set(), new Map())).toBeNull();
  });

  test('falls back to account_code when id is missing (legacy lines)', () => {
    const byId = new Set(['a1']);
    const byCode = new Map([['1110-0001', 'a1']]);
    expect(resolveLineAccountId({ account_id: null, account_code: '1110-0001' }, byId, byCode)).toBe('a1');
  });
});

describe('report loaders enforce posted history', () => {
  test('handles null account pages as empty data', async () => {
    await expect(loadReportAccounts(mockSupabase({ script: [{ data: null, error: null }] }), 'c1')).resolves.toEqual([]);
    await expect(loadReportJournalEntries(mockSupabase({ script: [{ data: null, error: null }] }), 'c1')).resolves.toEqual([]);
    await expect(loadReportJournalLines(mockSupabase({ script: [{ data: null, error: null }] }), 'c1', ['j1'])).resolves.toEqual([]);
  });

  test('falls back for legacy missing columns, paginates, and surfaces fatal account errors', async () => {
    const thousand = Array.from({ length: 1000 }, (_, id) => ({ id: String(id) }));
    const legacy = mockSupabase({ script: [
      { data: null, error: { message: 'column is_header 42703' } },
      { data: thousand, error: null }, { data: [{ id: 'last' }], error: null },
    ] });
    expect(await loadReportAccounts(legacy, 'c1')).toHaveLength(1001);
    const fatal = mockSupabase({ script: [{ data: null, error: new Error('fatal') }] });
    await expect(loadReportAccounts(fatal, 'c1')).rejects.toThrow('fatal');
    await expect(loadReportAccounts(mockSupabase({ script: [{ data: null, error: {} }] }), 'c1')).rejects.toEqual({});
  });

  test('paginates journal entry pages', async () => {
    const thousand = Array.from({ length: 1000 }, (_, id) => ({ id: String(id) }));
    await expect(loadReportJournalEntries(mockSupabase({ script: [{ data: thousand, error: null }, { data: [{ id: 'last' }], error: null }] }), 'c1')).resolves.toHaveLength(1001);
  });

  test('falls back for legacy journal deletion column and surfaces fatal errors', async () => {
    const legacy = mockSupabase({ script: [
      { data: null, error: { message: 'deleted_at missing' } },
      { data: [{ id: 'j1' }], error: null },
    ] });
    await expect(loadReportJournalEntries(legacy, 'c1', { from: '2026-01-01', to: '2026-12-31' })).resolves.toEqual([{ id: 'j1' }]);
    await expect(loadReportJournalEntries(mockSupabase({ script: [{ data: null, error: new Error('fatal') }] }), 'c1')).rejects.toThrow('fatal');
    await expect(loadReportJournalEntries(mockSupabase({ script: [{ data: null, error: {} }] }), 'c1')).rejects.toEqual({});
  });

  test('retains inactive accounts because deactivation cannot erase history', async () => {
    const db = mockSupabase({ rows: {
      accounts: [
        { id: 'active', company_id: 'c1', code: '1000', name: 'Active', type: 'asset', is_active: true },
        { id: 'inactive', company_id: 'c1', code: '4100', name: 'Historical', type: 'revenue', is_active: false },
      ],
    } });
    const rows = await loadReportAccounts(db, 'c1');
    expect(rows.map((row) => row.id)).toEqual(['active', 'inactive']);
  });

  test('loads journal lines only for requested entry chunks', async () => {
    const db = mockSupabase({ rows: { journal_lines: [
      { id: 'l1', company_id: 'c1', journal_entry_id: 'j1', debit: 10, credit: 0 },
      { id: 'l2', company_id: 'c1', journal_entry_id: 'j2', debit: 0, credit: 10 },
      { id: 'foreign', company_id: 'c2', journal_entry_id: 'j1', debit: 99, credit: 0 },
    ] } });
    const lines = await loadReportJournalLines(db, 'c1', ['j1']);
    expect(lines.map((line) => line.id)).toEqual(['l1']);
    expect(await loadReportJournalLines(db, 'c1', [])).toEqual([]);
  });

  test('paginates line chunks and surfaces line query errors', async () => {
    const thousand = Array.from({ length: 1000 }, (_, id) => ({ id }));
    const paged = mockSupabase({ script: [{ data: thousand, error: null }, { data: [{ id: 1000 }], error: null }] });
    expect(await loadReportJournalLines(paged, 'c1', ['j1'])).toHaveLength(1001);
    const failed = mockSupabase({ script: [{ data: null, error: new Error('lines') }] });
    await expect(loadReportJournalLines(failed, 'c1', ['j1'])).rejects.toThrow('lines');
  });

  test('excludes drafts and deleted journals but keeps a reversed source beside its reversal', async () => {
    const db = mockSupabase({ rows: {
      journal_entries: [
        { id: 'posted', company_id: 'c1', date: '2026-01-01', status: 'posted', reversed_by: null, deleted_at: null },
        { id: 'draft', company_id: 'c1', date: '2026-01-02', status: 'draft', reversed_by: null, deleted_at: null },
        { id: 'source', company_id: 'c1', date: '2026-01-03', status: 'rejected', reversed_by: 'reversal', deleted_at: null },
        { id: 'deleted', company_id: 'c1', date: '2026-01-04', status: 'posted', reversed_by: null, deleted_at: '2026-01-05' },
      ],
    } });
    const rows = await loadReportJournalEntries(db, 'c1');
    expect(rows.map((row) => row.id)).toEqual(['posted', 'source']);
    expect(db.calls[0].filters).toEqual(expect.arrayContaining([
      'eq:company_id:c1', 'or:status.eq.posted,reversed_by.not.is.null', 'is:deleted_at:null',
    ]));
  });
});
