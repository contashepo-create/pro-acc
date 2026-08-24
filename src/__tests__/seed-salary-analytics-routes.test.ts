/**
 * Route-boundary tests for previously-uncovered routes: accounts/seed-default,
 * salary-sheets GET/POST, reports/analytics.
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
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          if (o.op === 'neq') return r[o.col!] !== o.val;
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      insert: () => api,
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok ?? undefined, fail ?? undefined),
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
jest.mock('@/lib/default-accounts', () => ({ createDefaultChartOfAccounts: jest.fn(async () => 5) }));

import { POST as seedPOST } from '@/app/api/accounts/seed-default/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as salaryGET, POST as salaryPOST } from '@/app/api/salary-sheets/route';
import { GET as analyticsGET } from '@/app/api/reports/analytics/route';

const C1 = 'company-1';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, salary_sheets: true } } }],
    accounts: [], salary_sheets: [], salary_items: [],
    employees: [{ id: 'e1', company_id: C1 }],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('accounts/seed-default', () => {
  test('seeds default accounts (admin only) and audits', async () => {
    const res = await seedPOST(req('admin', 'POST', 'http://localhost/x'));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.created).toBe(5);
    expect(json.data.before).toBe(0);
  });
});

describe('salary-sheets', () => {
  test('GET lists tenant salary sheets', async () => {
    mockDb = makeDb({ ...baseDb(), salary_sheets: [{ id: 's1', company_id: C1, name: 'كشف', month: 2, year: 2026 }] });
    const res = await salaryGET(req('admin', 'GET', 'http://localhost/api/salary-sheets'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  test('POST rejects an invalid sheet and creates via RPC', async () => {
    const bad = await salaryPOST(req('admin', 'POST', 'http://localhost/x', { name: '', month: 0, year: 2026 }));
    expect(bad.status).toBe(400);
    mockDb.rpcResults.set('create_salary_sheet', { data: { id: 's1' }, error: null });
    const ok = await salaryPOST(req('admin', 'POST', 'http://localhost/x', { name: 'كشف', month: 2, year: 2026, items: [{ employeeId: 'e1', basicSalary: 100, allowances: 0, deductions: 0 }] }));
    expect(ok.status).toBe(201);
  });
});

describe('reports/analytics', () => {
  test('builds revenue chart, aging, top clients and invoice KPIs', async () => {
    mockDb.rpcResults.set('get_monthly_profit_loss', { data: [{ month_number: 1, revenue: 100, expenses: 60 }], error: null });
    mockDb.rpcResults.set('get_receivable_aging', { data: [{ bucket: '0-30', invoice_count: 2, amount: 80 }], error: null });
    mockDb.rpcResults.set('get_top_clients_by_revenue', { data: [{ name: 'عميل', revenue: 500, entry_count: 3 }], error: null });
    mockDb.rpcResults.set('get_project_profitability', { data: [], error: null });
    mockDb.rpcResults.set('get_invoice_kpis', { data: { total: 5, overdue: 1 }, error: null });
    const res = await analyticsGET(req('admin', 'GET', 'http://localhost/api/reports/analytics'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.revenueChart[0].revenue).toBe(100);
    expect(json.data.agingReport[0].range).toBe('0-30');
    expect(json.data.topClients[0].name).toBe('عميل');
  });
});
