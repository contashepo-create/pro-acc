/**
 * Deep coverage for reports/operational (material-issuances) and
 * reports/project-profit-loss.
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

import { GET as opGET } from '@/app/api/reports/operational/route';
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
    projects: [], inventory_transactions: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('reports/operational material-issuances', () => {
  test('returns material issuances', async () => {
    mockDb = makeDb({ ...baseDb(), inventory_transactions: [
      { id: ID1, company_id: C1, status: 'posted', type: 'issue', date: '2026-01-15', inventory_items: { name: 'صنف', code: 'IT-1' }, projects: { name: 'مشروع' } },
    ] });
    const res = await opGET(req('admin', 'GET', 'http://localhost/api/reports/operational?type=material-issuances'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rows[0].item_name).toBe('صنف');
    expect(json.data.rows[0].project_name).toBe('مشروع');
  });
});

describe('reports/project-profit-loss deep', () => {
  test('computes profit for a project', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1, name: 'مشروع', contract_value: 1000, contacts: { name: 'عميل' }, status: 'active' }] });
    mockDb.rpcResults.set('get_project_account_totals', {
      data: [
        { code: '4100', name: 'إيراد', account_type: 'revenue', debit: 0, credit: 500 },
        { code: '5110', name: 'مواد', account_type: 'expense', debit: 300, credit: 0 },
      ], error: null,
    });
    mockDb.rpcResults.set('get_project_billing_totals', { data: [{ net_billed: 500, credits: 0 }], error: null });
    mockDb.rpcResults.set('get_project_costing_overhead', { data: [{ project_id: ID1, allocated_overhead: 50 }], error: null });
    const res = await pplGET(req('admin', 'GET', `http://localhost/api/reports/project-profit-loss?project_id=${ID1}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.financials.revenue).toBe(500);
    expect(json.data.financials.costs.total).toBe(300);
    expect(json.data.financials.allocated_overhead).toBe(50);
  });
});
