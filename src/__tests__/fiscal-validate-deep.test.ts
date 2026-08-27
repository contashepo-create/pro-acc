/**
 * Deep coverage for /api/fiscal/validate-balances with real accounts and
 * journal lines producing valid and invalid balances.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown } | null>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string): unknown => {
            let cur: unknown = r;
            for (const k of col.split('.')) {
              if (cur == null) break;
              cur = (cur as Record<string, unknown>)[k];
            }
            return cur;
          };
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(get(o.col!));
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: () => api, update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok ?? undefined, fail ?? undefined),
    };
    return api;
  };
  return {
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as validateGET } from '@/app/api/fiscal/validate-balances/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000b1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x') {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined } } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    accounts: [], journal_lines: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('fiscal/validate-balances deep', () => {
  test('flags a negative asset balance', async () => {
    mockDb = makeDb({ ...baseDb(),
      accounts: [{ id: A1, company_id: C1, code: '1110', name: 'نقد', type: 'asset', parent_id: null, is_active: true }],
      journal_lines: [{ id: 'l1', company_id: C1, account_id: A1, debit: 0, credit: 100 }],
    });
    const res = await validateGET(req('admin', 'GET', 'http://localhost/api/fiscal/validate-balances'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.issues.length).toBeGreaterThan(0);
    expect(json.data.totalIssues).toBeGreaterThan(0);
  });

  test('accepts a valid asset and flags a positive liability', async () => {
    mockDb = makeDb({ ...baseDb(),
      accounts: [
        { id: A1, company_id: C1, code: '1110', name: 'نقد', type: 'asset', parent_id: null, is_active: true },
        { id: A2, company_id: C1, code: '2120', name: 'دائن', type: 'liability', parent_id: null, is_active: true },
      ],
      journal_lines: [
        { id: 'l1', company_id: C1, account_id: A1, debit: 100, credit: 0 },
        { id: 'l2', company_id: C1, account_id: A2, debit: 100, credit: 0 },
      ],
    });
    const res = await validateGET(req('admin', 'GET', 'http://localhost/api/fiscal/validate-balances'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.issues.some((i: Row) => i.accountCode === '2120')).toBe(true);
  });

  test('handles a contra depreciation asset (1290)', async () => {
    mockDb = makeDb({ ...baseDb(),
      accounts: [{ id: A1, company_id: C1, code: '1290', name: 'مجمع الإهلاك', type: 'asset', parent_id: null, is_active: true }],
      journal_lines: [{ id: 'l1', company_id: C1, account_id: A1, debit: 50, credit: 0 }],
    });
    const res = await validateGET(req('admin', 'GET', 'http://localhost/api/fiscal/validate-balances'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.issues.some((i: Row) => i.accountCode === '1290')).toBe(true);
  });
});
