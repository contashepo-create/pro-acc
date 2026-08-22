/**
 * Route-boundary tests for purchases/orders/[id], purchases/invoices/[id],
 * vouchers/receipt/[id] GET, vouchers/disbursement/[id] GET, budgets GET deep.
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
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
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

import { GET as poGET, PUT as poPUT } from '@/app/api/purchases/orders/[id]/route';
import { GET as piGET, PUT as piPUT } from '@/app/api/purchases/invoices/[id]/route';
import { GET as rcptGET } from '@/app/api/vouchers/receipt/[id]/route';
import { GET as disbGET } from '@/app/api/vouchers/disbursement/[id]/route';
import { GET as budgetGET } from '@/app/api/budgets/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { purchases: true, journal: true, budgets: true, projects: true } } }],
    purchase_orders: [], purchase_order_items: [], purchase_invoices: [], purchase_invoice_items: [],
    voucher_receipts: [], receipt_invoice_items: [], voucher_disbursements: [], disbursement_invoice_items: [],
    projects: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('purchases/orders/[id]', () => {
  test('GET returns an order with items and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), purchase_orders: [{ id: ID1, company_id: C1, contacts: { name: 'مورد' } }], purchase_order_items: [] });
    const res = await poGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.supplier_name).toBe('مورد');
  });

  test('GET returns 404 when missing', async () => {
    const res = await poGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });

  test('PUT updates an order', async () => {
    mockDb.rpcResults.set('update_purchase_order_atomic', { data: { id: ID1 }, error: null });
    const res = await poPUT(req('admin', 'PUT', 'http://localhost/x', { notes: 'ملاحظة' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('purchases/invoices/[id]', () => {
  test('GET returns an invoice with items and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), purchase_invoices: [{ id: ID1, company_id: C1, contacts: { name: 'مورد' }, paid_amount: 0 }], purchase_invoice_items: [] });
    const res = await piGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.supplier_name).toBe('مورد');
  });

  test('GET returns 404 when missing', async () => {
    const res = await piGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });

  test('PUT rejects a manual payment-status change (409)', async () => {
    const res = await piPUT(req('admin', 'PUT', 'http://localhost/x', { status: 'paid' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(409);
  });

  test('PUT cancels an invoice', async () => {
    mockDb.rpcResults.set('cancel_purchase_invoice_atomic', { data: { id: ID1 }, error: null });
    const res = await piPUT(req('admin', 'PUT', 'http://localhost/x', { status: 'cancelled' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('vouchers/receipt/[id] GET', () => {
  test('returns a receipt with invoice items and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), voucher_receipts: [{ id: ID1, company_id: C1, contacts: { name: 'عميل' }, journal_entries: { number: 5 } }],
      receipt_invoice_items: [] });
    const res = await rcptGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contact_name).toBe('عميل');
    expect(json.data.journal_entry_number).toBe(5);
  });

  test('GET returns 404 when missing', async () => {
    const res = await rcptGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });
});

describe('vouchers/disbursement/[id] GET', () => {
  test('returns a disbursement with invoice items', async () => {
    mockDb = makeDb({ ...baseDb(), voucher_disbursements: [{ id: ID1, company_id: C1, contacts: { name: 'مورد' }, employees: { name: 'موظف' } }],
      disbursement_invoice_items: [] });
    const res = await disbGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contact_name).toBe('مورد');
    expect(json.data.employee_name).toBe('موظف');
  });
});

describe('budgets GET deep', () => {
  test('returns budgets with variance summary', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1 }] });
    mockDb.rpcResults.set('get_project_budget_rows', { data: [{ project_id: ID1, category: 'materials', amount: 1000, actual_spent: 600 }], error: null });
    const res = await budgetGET(req('admin', 'GET', `http://localhost/api/budgets?project_id=${ID1}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.budgets[0].variance).toBe(400);
    expect(json.data.summary.totalBudget).toBe(1000);
  });
});
