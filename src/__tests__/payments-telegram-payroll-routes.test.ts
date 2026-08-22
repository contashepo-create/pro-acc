/**
 * Route-boundary tests for previously-uncovered routes: payments GET,
 * settings/telegram GET, salary-sheets/[id] GET, subcontractors/payments POST.
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
jest.mock('@/lib/payments/moyasar', () => ({ initPayment: jest.fn(), getPaymentStatus: jest.fn(), mapPaymentStatus: (s: string) => s }));

import { GET as paymentsGET } from '@/app/api/payments/route';
import { GET as telegramGET } from '@/app/api/settings/telegram/route';
import { GET as salarySheetGET } from '@/app/api/salary-sheets/[id]/route';
import { POST as subcontractorPaymentPOST } from '@/app/api/subcontractors/payments/route';

const C1 = 'company-1';
const ID = '00000000-0000-4000-8000-000000000001';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { invoices: true, salary_sheets: true, subcontractors: true, telegram_integration: true } } }],
    payment_records: [], company_telegram_configs: [], salary_sheets: [], salary_items: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('payments GET', () => {
  test('lists tenant payment records', async () => {
    mockDb = makeDb({ ...baseDb(), payment_records: [{ id: 'p1', company_id: C1, invoices: { number: 1, total: 100 } }] });
    const res = await paymentsGET(req('admin', 'GET', 'http://localhost/api/payments'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.payments).toHaveLength(1);
  });
});

describe('settings/telegram GET', () => {
  test('returns config or the plan-gated response', async () => {
    const res = await telegramGET(req('admin', 'GET', 'http://localhost/api/settings/telegram'));
    expect([200, 403]).toContain(res.status);
  });
});

describe('salary-sheets/[id] GET', () => {
  test('returns 404 for a missing sheet', async () => {
    const res = await salarySheetGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(404);
  });

  test('returns a sheet with employee items', async () => {
    mockDb = makeDb({ ...baseDb(), salary_sheets: [{ id: ID, company_id: C1, name: 'كشف' }],
      salary_items: [{ id: 'i1', sheet_id: ID, company_id: C1, employees: { name: 'موظف' } }] });
    const res = await salarySheetGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items[0].employee_name).toBe('موظف');
  });
});

describe('subcontractors/payments POST', () => {
  test('rejects a missing required contract/bank', async () => {
    const res = await subcontractorPaymentPOST(req('admin', 'POST', 'http://localhost/x', { amount: 100 }));
    expect(res.status).toBe(400);
  });
});
