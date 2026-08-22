/**
 * Route-boundary tests for reports/financial, reports/analytics,
 * reports/anomalies, reports/general-ledger, invoices/[id]/zatca.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, any>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string) => col.split('.').reduce((acc, k) => (acc == null ? acc : (acc as any)[k]), r);
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(get(o.col!));
          if (o.op === 'neq') return get(o.col!) !== o.val;
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: () => api, update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
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

import { GET as finGET } from '@/app/api/reports/financial/route';
import { GET as anGET } from '@/app/api/reports/analytics/route';
import { GET as anomGET } from '@/app/api/reports/anomalies/route';
import { GET as glGET } from '@/app/api/reports/general-ledger/route';
import { GET as zatcaGET } from '@/app/api/invoices/[id]/zatca/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x') {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined } } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { reports_basic: true, reports_advanced: true, invoices: true } } }],
    accounts: [], cost_centers: [], branches: [], invoices: [], invoice_items: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('reports/financial', () => {
  test('returns a trial balance', async () => {
    mockDb.rpcResults.set('get_financial_statement_rows', { data: [], error: null });
    const res = await finGET(req('admin', 'GET', 'http://localhost/api/reports/financial?type=trial_balance'));
    expect(res.status).toBe(200);
  });

  test('rejects an invalid type and date', async () => {
    const res1 = await finGET(req('admin', 'GET', 'http://localhost/api/reports/financial?type=bogus'));
    expect(res1.status).toBe(400);
    const res2 = await finGET(req('admin', 'GET', 'http://localhost/api/reports/financial?from=bad'));
    expect(res2.status).toBe(400);
  });
});

describe('reports/analytics', () => {
  test('returns analytics from posted ledger', async () => {
    mockDb.rpcResults.set('get_monthly_profit_loss', { data: [], error: null });
    mockDb.rpcResults.set('get_receivable_aging', { data: [], error: null });
    mockDb.rpcResults.set('get_top_clients_by_revenue', { data: [], error: null });
    mockDb.rpcResults.set('get_project_profitability', { data: [], error: null });
    mockDb.rpcResults.set('get_invoice_kpis', { data: {}, error: null });
    const res = await anGET(req('admin', 'GET', 'http://localhost/api/reports/analytics'));
    expect(res.status).toBe(200);
  });
});

describe('reports/anomalies', () => {
  test('returns an anomaly scan', async () => {
    mockDb.rpcResults.set('get_monthly_profit_loss', { data: [], error: null });
    const res = await anomGET(req('admin', 'GET', 'http://localhost/api/reports/anomalies'));
    expect(res.status).toBe(200);
  });
});

describe('reports/general-ledger', () => {
  test('returns a general ledger', async () => {
    mockDb.rpcResults.set('get_general_ledger_rows', { data: [], error: null });
    mockDb.rpcResults.set('get_general_ledger_totals', { data: { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0 }, error: null });
    const res = await glGET(req('admin', 'GET', 'http://localhost/api/reports/general-ledger?from=2026-01-01&to=2026-12-31'));
    expect(res.status).toBe(200);
  });

  test('returns 404 for an unknown account filter', async () => {
    const res = await glGET(req('admin', 'GET', `http://localhost/api/reports/general-ledger?account_id=${ID1}`));
    expect(res.status).toBe(404);
  });
});

describe('invoices/[id]/zatca GET', () => {
  test('rejects an invalid id and returns 404 for unknown invoice', async () => {
    const res1 = await zatcaGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(400);
    const res2 = await zatcaGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(404);
  });
});
