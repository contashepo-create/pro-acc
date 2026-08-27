/**
 * Deep coverage for /api/reports/cash-flow with real cash accounts and
 * journal lines producing inflows/outflows.
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
          if (o.op === 'gte') return String(get(o.col!)) >= String(o.val);
          if (o.op === 'lte') return String(get(o.col!)) <= String(o.val);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
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

import { GET as cashflowGET } from '@/app/api/reports/cash-flow/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const CASH = '00000000-0000-4000-8000-00000000f0f1';
const REV = '00000000-0000-4000-8000-00000000f0f2';

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
      subscription_plans: { code: 'enterprise', features_modules: { reports_basic: true } } }],
    accounts: [], banks_safes: [], journal_entries: [], journal_lines: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('reports/cash-flow deep', () => {
  test('allocates operating inflows from cash journal lines', async () => {
    mockDb = makeDb({ ...baseDb(),
      accounts: [
        { id: CASH, company_id: C1, code: '1110', name: 'نقد', type: 'asset' },
        { id: REV, company_id: C1, code: '4100', name: 'إيراد', type: 'revenue' },
      ],
      banks_safes: [],
      journal_entries: [{ id: 'je1', company_id: C1, date: '2026-01-15', number: 1, description: 'قيد', status: 'posted' }],
      journal_lines: [
        { journal_entry_id: 'je1', company_id: C1, account_id: CASH, account_code: '1110', debit: 100, credit: 0 },
        { journal_entry_id: 'je1', company_id: C1, account_id: REV, account_code: '4100', debit: 0, credit: 100 },
      ],
    });
    const res = await cashflowGET(req('admin', 'GET', 'http://localhost/api/reports/cash-flow?from=2026-01-01&to=2026-01-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.operating.total_inflows).toBe(100);
    expect(json.data.net_change).toBe(100);
  });
});
