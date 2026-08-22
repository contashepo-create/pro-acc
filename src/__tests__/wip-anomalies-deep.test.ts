/**
 * Deep coverage for reports/wip (with project data) and reports/anomalies
 * (with invoice data).
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

import { GET as wipGET } from '@/app/api/reports/wip/route';
import { GET as anomGET } from '@/app/api/reports/anomalies/route';
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
      subscription_plans: { code: 'enterprise', features_modules: { reports_advanced: true, reports_basic: true } } }],
    invoices: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('reports/wip deep', () => {
  test('computes WIP for active projects', async () => {
    mockDb.rpcResults.set('get_report_projects', { data: [{ project_id: ID1, name: 'مشروع', contract_value: 1000, client_name: 'عميل' }], error: null });
    mockDb.rpcResults.set('get_project_account_totals', { data: [{ project_id: ID1, account_type: 'expense', debit: 100, credit: 0 }], error: null });
    mockDb.rpcResults.set('get_project_billing_totals', { data: [{ project_id: ID1, net_billed: 200 }], error: null });
    const res = await wipGET(req('admin', 'GET', 'http://localhost/api/reports/wip'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rows[0].contract_amount).toBe(1000);
    expect(json.data.rows[0].costs_incurred).toBe(100);
    expect(json.data.rows[0].billed_to_date).toBe(200);
  });
});

describe('reports/anomalies deep', () => {
  test('detects anomalies from invoices', async () => {
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: ID1, company_id: C1, contact_id: ID1, total: 100, date: '2026-01-15', status: 'posted' }] });
    mockDb.rpcResults.set('get_monthly_profit_loss', { data: [{ month_number: 1, expenses: 50 }], error: null });
    const res = await anomGET(req('admin', 'GET', 'http://localhost/api/reports/anomalies'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data.findings)).toBe(true);
  });
});
