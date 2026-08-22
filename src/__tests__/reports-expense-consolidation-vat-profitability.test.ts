/**
 * Route-boundary tests for reports: expense-analysis, consolidation, vat,
 * profitability, cost-center, project-profit-loss.
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
          if (o.op === 'gte') return String(get(o.col!)) >= String(o.val);
          if (o.op === 'lte') return String(get(o.col!)) <= String(o.val);
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api,
      or: () => api, lt: () => api, gte: (col: string, val: any) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: any) => { ops.push({ op: 'lte', col, val }); return api; },
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

import { GET as expenseGET } from '@/app/api/reports/expense-analysis/route';
import { GET as consolGET } from '@/app/api/reports/consolidation/route';
import { GET as vatGET } from '@/app/api/reports/vat/route';
import { GET as profGET } from '@/app/api/reports/profitability/route';
import { GET as ccGET } from '@/app/api/reports/cost-center/route';
import { GET as pplGET } from '@/app/api/reports/project-profit-loss/route';
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
      subscription_plans: { code: 'enterprise', features_modules: { reports_basic: true, reports_advanced: true, projects: true } } }],
    projects: [], invoices: [], purchase_invoices: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('reports/expense-analysis', () => {
  test('returns expense categories', async () => {
    mockDb.rpcResults.set('get_account_period_totals', { data: [{ account_id: ID1, code: '5110', name: 'مواد', debit: 100, credit: 0 }], error: null });
    const res = await expenseGET(req('admin', 'GET', 'http://localhost/api/reports/expense-analysis'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total_expense).toBe(100);
  });

  test('rejects an invalid period', async () => {
    const res = await expenseGET(req('admin', 'GET', 'http://localhost/api/reports/expense-analysis?from=bad'));
    expect(res.status).toBe(400);
  });
});

describe('reports/consolidation', () => {
  test('returns a consolidated trial balance', async () => {
    mockDb.rpcResults.set('get_trial_balance_rows', { data: [], error: null });
    const res = await consolGET(req('admin', 'GET', 'http://localhost/api/reports/consolidation'));
    expect(res.status).toBe(200);
  });

  test('rejects an invalid as_of_date', async () => {
    const res = await consolGET(req('admin', 'GET', 'http://localhost/api/reports/consolidation?as_of_date=bad'));
    expect(res.status).toBe(400);
  });
});

describe('reports/vat', () => {
  test('returns a VAT report', async () => {
    mockDb.rpcResults.set('get_vat_return_summary', { data: { outputVat: 15, inputVat: 5 }, error: null });
    mockDb.rpcResults.set('get_vat_ledger_lines', { data: [], error: null });
    const res = await vatGET(req('admin', 'GET', 'http://localhost/api/reports/vat?from=2026-01-01&to=2026-01-31'));
    expect(res.status).toBe(200);
  });

  test('rejects an invalid period', async () => {
    const res = await vatGET(req('admin', 'GET', 'http://localhost/api/reports/vat?from=bad'));
    expect(res.status).toBe(400);
  });
});

describe('reports/profitability', () => {
  test('returns project profitability', async () => {
    mockDb.rpcResults.set('get_report_projects', { data: [], error: null });
    mockDb.rpcResults.set('get_project_billing_totals', { data: [], error: null });
    const res = await profGET(req('admin', 'GET', 'http://localhost/api/reports/profitability'));
    expect(res.status).toBe(200);
  });

  test('rejects an invalid period', async () => {
    const res = await profGET(req('admin', 'GET', 'http://localhost/api/reports/profitability?from=bad'));
    expect(res.status).toBe(400);
  });
});

describe('reports/cost-center', () => {
  test('returns cost center profitability', async () => {
    mockDb.rpcResults.set('get_cost_center_profitability', { data: [], error: null });
    const res = await ccGET(req('admin', 'GET', 'http://localhost/api/reports/cost-center'));
    expect(res.status).toBe(200);
  });
});

describe('reports/project-profit-loss', () => {
  test('rejects an invalid project id and returns 404 for unknown project', async () => {
    const res1 = await pplGET(req('admin', 'GET', 'http://localhost/api/reports/project-profit-loss?project_id=bad'));
    expect(res1.status).toBe(400);
    const res2 = await pplGET(req('admin', 'GET', `http://localhost/api/reports/project-profit-loss?project_id=${ID1}`));
    expect(res2.status).toBe(404);
  });
});
