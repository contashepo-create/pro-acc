import {
  loadReportAccounts, loadReportJournalEntries, loadReportJournalLines, resolveLineAccountId,
} from '@/lib/report-journal';

describe('report line → account resolution', () => {
  test('prefers account_id when it exists on the chart', () => {
    const byId = new Set(['a1']);
    const byCode = new Map([['1110-0001', 'a1']]);
    expect(resolveLineAccountId({ account_id: 'a1', account_code: 'x' }, byId, byCode)).toBe('a1');
  });

  test('falls back to account_code when id is missing (legacy lines)', () => {
    const byId = new Set(['a1']);
    const byCode = new Map([['1110-0001', 'a1']]);
    expect(resolveLineAccountId({ account_id: null, account_code: '1110-0001' }, byId, byCode)).toBe('a1');
  });
});

function fakeSupabase(tables: Record<string, any[]>) {
  const calls: Array<{ table: string; filters: string[] }> = [];
  return {
    calls,
    from(table: string) {
      const filters: string[] = [];
      let rows = [...(tables[table] || [])];
      let rangeStart = 0;
      let rangeEnd = 999;
      calls.push({ table, filters });
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push(`eq:${column}:${value}`);
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          filters.push(`in:${column}:${values.join(',')}`);
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        or: (expression: string) => {
          filters.push(`or:${expression}`);
          if (expression === 'status.eq.posted,reversed_by.not.is.null') {
            rows = rows.filter((row) => row.status === 'posted' || row.reversed_by != null);
          }
          return query;
        },
        is: (column: string, value: unknown) => {
          filters.push(`is:${column}:${value}`);
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        gte: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] >= (value as number));
          return query;
        },
        lte: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] <= (value as number));
          return query;
        },
        order: () => query,
        range: (start: number, end: number) => { rangeStart = start; rangeEnd = end; return query; },
        then: (resolve: any, reject: any) => Promise.resolve({
          data: rows.slice(rangeStart, rangeEnd + 1), error: null,
        }).then(resolve, reject),
      };
      return query;
    },
  };
}

describe('report loaders enforce posted history', () => {
  test('retains inactive accounts because deactivation cannot erase history', async () => {
    const db = fakeSupabase({
      accounts: [
        { id: 'active', company_id: 'c1', code: '1000', name: 'Active', type: 'asset', is_active: true },
        { id: 'inactive', company_id: 'c1', code: '4100', name: 'Historical', type: 'revenue', is_active: false },
      ],
    });
    const rows = await loadReportAccounts(db, 'c1');
    expect(rows.map((row) => row.id)).toEqual(['active', 'inactive']);
  });

  test('loads journal lines only for requested entry chunks', async () => {
    const db = fakeSupabase({ journal_lines: [
      { id: 'l1', company_id: 'c1', journal_entry_id: 'j1', debit: 10, credit: 0 },
      { id: 'l2', company_id: 'c1', journal_entry_id: 'j2', debit: 0, credit: 10 },
      { id: 'foreign', company_id: 'c2', journal_entry_id: 'j1', debit: 99, credit: 0 },
    ] });
    const lines = await loadReportJournalLines(db, 'c1', ['j1']);
    expect(lines.map((line) => line.id)).toEqual(['l1']);
    expect(await loadReportJournalLines(db, 'c1', [])).toEqual([]);
  });

  test('excludes drafts and deleted journals but keeps a reversed source beside its reversal', async () => {
    const db = fakeSupabase({
      journal_entries: [
        { id: 'posted', company_id: 'c1', date: '2026-01-01', status: 'posted', reversed_by: null, deleted_at: null },
        { id: 'draft', company_id: 'c1', date: '2026-01-02', status: 'draft', reversed_by: null, deleted_at: null },
        { id: 'source', company_id: 'c1', date: '2026-01-03', status: 'rejected', reversed_by: 'reversal', deleted_at: null },
        { id: 'deleted', company_id: 'c1', date: '2026-01-04', status: 'posted', reversed_by: null, deleted_at: '2026-01-05' },
      ],
    });
    const rows = await loadReportJournalEntries(db, 'c1');
    expect(rows.map((row) => row.id)).toEqual(['posted', 'source']);
    expect(db.calls[0].filters).toEqual(expect.arrayContaining([
      'eq:company_id:c1', 'or:status.eq.posted,reversed_by.not.is.null', 'is:deleted_at:null',
    ]));
  });
});
