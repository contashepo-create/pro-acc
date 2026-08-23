import { ensureDefaultCashSafe, createDefaultChartOfAccounts, DEFAULT_CHART_OF_ACCOUNTS } from '@/lib/default-accounts';
import { wrapSupabase } from './mocks';
import type { TestBuilder } from './mocks';
type Row = Record<string, unknown>;

function makeEnsureDb(opts: { existing?: Row; cash?: Row; created?: Row | null }) {
  return wrapSupabase({ from: (table: string) => {
    let mode = 'select'; let insertPayload: Row | Row[] | undefined;
    const api: TestBuilder = {
      select: () => api, eq: () => api, limit: () => api,
      insert: (payload: Row | Row[]) => { mode = 'insert'; insertPayload = payload; return api; },
      maybeSingle: async () => ({ data: table === 'banks_safes' ? opts.existing || null : opts.cash || null, error: null }),
      single: async () => ({ data: mode === 'insert' ? opts.created || null : null, error: null }),
    };
    return api;
  } });
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
    const stored: Row[] = [];
    let insertCount = 0;
    const db = wrapSupabase({ from: (table: string) => {
      let mode = 'select'; let payload: Row | Row[] | undefined; const filters: Record<string, unknown> = {};
      const api: TestBuilder = {
        select: () => api,
        eq: (field: string, value: unknown) => { filters[field] = value; return api; }, limit: () => api,
        maybeSingle: async () => ({ data: table === 'accounts' ? stored.find((r) => r.code === filters.code) || null : null, error: null }),
        insert: (value: Row | Row[]) => { mode = 'insert'; payload = value; return api; },
        update: () => { mode = 'update'; return api; },
        single: async () => {
          if (table === 'accounts' && mode === 'insert') {
            insertCount++;
            if (insertCount === 1) return { data: null, error: { code: '42703' } };
            if (insertCount === 3) return { data: null, error: { message: 'column is_header missing' } };
            const row = { ...(payload as Row), id: `a${insertCount}` }; stored.push(row); return { data: row, error: null };
          }
          if (table === 'banks_safes' && mode === 'insert') return { data: { id: 'safe' }, error: null };
          return { data: null, error: null };
        },
        then: <T1 = { data: unknown; error: unknown }, T2 = never>(
          resolve?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
          reject?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
        ) => Promise.resolve({ data: null, error: null }).then(resolve ?? undefined, reject ?? undefined),
      };
      return api;
    } });
    await expect(createDefaultChartOfAccounts(db, 'c')).resolves.toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(stored[0]).not.toHaveProperty('is_header');
  });

  test('catches parent-link and default-safe failures after loading existing chart', async () => {
    const db = wrapSupabase({ from: (table: string) => {
      if (table === 'banks_safes') throw new Error('safe');
      let code = '';
      const api: TestBuilder = {
        select: () => api,
        eq: (field: string, value: string) => { if (field === 'code') code = value; return api; },
        maybeSingle: async () => ({ data: { id: `existing-${code}` }, error: null }),
        update: () => { throw new Error('parent'); },
      };
      return api;
    } });
    await expect(createDefaultChartOfAccounts(db, 'c')).resolves.toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
  });

  test('continues after account lookup/parent/safe failures', async () => {
    let calls = 0;
    const db = wrapSupabase({ from: (_table: string) => {
      const api: TestBuilder = {
        select: () => api, eq: () => api, limit: () => api,
        maybeSingle: async () => { calls++; if (calls === 1) throw new Error('lookup'); return { data: null, error: null }; },
        insert: () => api, update: () => { throw new Error('update'); },
        single: async () => ({ data: null, error: null }),
      };
      return api;
    } });
    await expect(createDefaultChartOfAccounts(db, 'c')).resolves.toBe(0);
  });
});
