/**
 * Route-boundary tests for previously-uncovered simple config/report routes:
 * reports/expense-analysis, categories, branches, budgets, cost-centers.
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
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api,
      is: () => api, neq: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
    };
    return api;
  };
  return {
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: [], error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as expenseAnalysisGET } from '@/app/api/reports/expense-analysis/route';
import { GET as categoriesGET } from '@/app/api/categories/route';
import { GET as branchesGET } from '@/app/api/branches/route';
import { GET as budgetsGET } from '@/app/api/budgets/route';
import { GET as costCentersGET } from '@/app/api/cost-centers/route';

const C1 = 'company-1';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, categories: true, branches: true, budgets: true, cost_centers: true } } }],
    transaction_categories: [], branches: [], project_budgets: [], cost_centers: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('reports/expense-analysis', () => {
  test('rejects an invalid period and computes category percentages', async () => {
    const bad = await expenseAnalysisGET(req('admin', 'GET', 'http://localhost/x?from=2026-02-01&to=2026-01-01'));
    expect(bad.status).toBe(400);
    mockDb.rpcResults.set('get_account_period_totals', { data: [
      { account_id: 'a', code: '5110', name: 'مواد', debit: 300, credit: 0 },
      { account_id: 'b', code: '5120', name: 'عمالة', debit: 100, credit: 0 },
    ], error: null });
    const res = await expenseAnalysisGET(req('admin', 'GET', 'http://localhost/x'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total_expense).toBe(400);
    expect(json.data.categories[0].name).toBe('مواد');
    expect(json.data.categories[0].percentage).toBe(75);
  });
});

describe('config GET routes', () => {
  test('categories lists tenant rows', async () => {
    mockDb = makeDb({ ...baseDb(), transaction_categories: [{ id: 'c1', company_id: C1, name: 'فئة', accounts: { code: '5110', name: 'مواد' } }] });
    const res = await categoriesGET(req('admin', 'GET', 'http://localhost/api/categories'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.categories[0].account_code).toBe('5110');
  });

  test('branches lists tenant rows', async () => {
    const res = await branchesGET(req('admin', 'GET', 'http://localhost/api/branches'));
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).data.branches)).toBe(true);
  });

  test('budgets lists tenant rows', async () => {
    const res = await budgetsGET(req('admin', 'GET', 'http://localhost/api/budgets'));
    expect(res.status).toBe(200);
  });

  test('cost-centers lists tenant rows', async () => {
    const res = await costCentersGET(req('admin', 'GET', 'http://localhost/api/cost-centers'));
    expect(res.status).toBe(200);
  });
});
