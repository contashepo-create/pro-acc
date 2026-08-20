import { ensureDefaultCashSafe, createDefaultChartOfAccounts, DEFAULT_CHART_OF_ACCOUNTS } from '@/lib/default-accounts';

function makeEnsureDb(opts: { existing?: any; cash?: any; created?: any }) {
  return { from: (table: string) => {
    let mode = 'select'; let insertPayload: any;
    const api: any = {
      select: () => api, eq: () => api, limit: () => api,
      insert: (payload: any) => { mode = 'insert'; insertPayload = payload; return api; },
      maybeSingle: async () => ({ data: table === 'banks_safes' ? opts.existing || null : opts.cash || null, error: null }),
      single: async () => ({ data: mode === 'insert' ? opts.created || null : null, error: null }),
    };
    return api;
  } };
}

describe('default cash safe branches', () => {
  test('returns an existing safe without creating another', async () => {
    await expect(ensureDefaultCashSafe(makeEnsureDb({ existing: { id: 'safe1' } }), 'c')).resolves.toBe('safe1');
  });
  test('uses supplied or chart cash account and handles missing/create failure', async () => {
    await expect(ensureDefaultCashSafe(makeEnsureDb({ created: { id: 'new' } }), 'c', 'cash')).resolves.toBe('new');
    await expect(ensureDefaultCashSafe(makeEnsureDb({ cash: { id: 'chart' }, created: { id: 'new2' } }), 'c')).resolves.toBe('new2');
    await expect(ensureDefaultCashSafe(makeEnsureDb({}), 'c')).resolves.toBeNull();
    await expect(ensureDefaultCashSafe(makeEnsureDb({ created: null }), 'c', 'cash')).resolves.toBeNull();
  });
});

describe('chart bootstrap compatibility/error branches', () => {
  test('retries inserts without is_header on legacy schemas', async () => {
    const stored: any[] = [];
    let insertCount = 0;
    const db = { from: (table: string) => {
      let mode = 'select'; let payload: any; const filters: Record<string, any> = {};
      const api: any = {
        select: () => api,
        eq: (field: string, value: any) => { filters[field] = value; return api; }, limit: () => api,
        maybeSingle: async () => ({ data: table === 'accounts' ? stored.find((r) => r.code === filters.code) || null : null, error: null }),
        insert: (value: any) => { mode = 'insert'; payload = value; return api; },
        update: () => { mode = 'update'; return api; },
        single: async () => {
          if (table === 'accounts' && mode === 'insert') {
            insertCount++;
            if (insertCount === 1) return { data: null, error: { message: 'column is_header missing', code: '42703' } };
            const row = { ...payload, id: `a${insertCount}` }; stored.push(row); return { data: row, error: null };
          }
          if (table === 'banks_safes' && mode === 'insert') return { data: { id: 'safe' }, error: null };
          return { data: null, error: null };
        },
        then: (resolve: any, reject: any) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
      };
      return api;
    } };
    await expect(createDefaultChartOfAccounts(db, 'c')).resolves.toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(stored[0]).not.toHaveProperty('is_header');
  });

  test('continues after account lookup/parent/safe failures', async () => {
    let calls = 0;
    const db = { from: (_table: string) => {
      const api: any = {
        select: () => api, eq: () => api, limit: () => api,
        maybeSingle: async () => { calls++; if (calls === 1) throw new Error('lookup'); return { data: null, error: null }; },
        insert: () => api, update: () => { throw new Error('update'); },
        single: async () => ({ data: null, error: { message: 'ordinary failure' } }),
      };
      return api;
    } };
    await expect(createDefaultChartOfAccounts(db, 'c')).resolves.toBe(0);
  });
});
