/** Route-boundary tests for atomic purchase invoice/order lifecycles.
 * Deep totals, ledger balance, rollback, IDOR and receive concurrency are
 * covered by scripts/test-migrations.mjs against PostgreSQL.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };
function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: Row | Row[] } }> = [];
  const rpcCalls: Array<{ name: string; params?: Row }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = []; const mut: { kind?: string; payload?: Row | Row[] } = {}; calls.push({ table, ops, mut });
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'in') return (op.val as unknown[]).includes(row[op.col!]);
      if (op.op === 'gte') return String(row[op.col!]) >= String(op.val);
      return true;
    }));
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      neq: () => api, is: () => api, or: () => api, order: () => api, limit: () => api, range: () => api,
      insert: (payload: Row | Row[]) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: Row) => { mut.kind = 'update'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
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
    from, calls, rpcCalls, rpcResults,
    rpc: async (name: string, params?: Row): Promise<{ data: unknown; error: unknown }> => {
      rpcCalls.push({ name, params });
      return rpcResults.get(name) || { data: { id: `${name}-id`, status: 'pending' }, error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as invoicesGET, POST as invoicePOST } from '@/app/api/purchases/invoices/route';
import { GET as invoiceGET, PUT as invoicePUT, DELETE as invoiceDELETE } from '@/app/api/purchases/invoices/[id]/route';
import { GET as ordersGET, POST as orderPOST } from '@/app/api/purchases/orders/route';
import { GET as orderGET, PUT as orderPUT, PATCH as orderPATCH, DELETE as orderDELETE } from '@/app/api/purchases/orders/[id]/route';

const C1 = 'company-1'; const USER = 'u1';
const SUPPLIER = '00000000-0000-4000-8000-000000000501';
const PI = '00000000-0000-4000-8000-000000000601';
const FOREIGN_PI = '00000000-0000-4000-8000-000000000609';
const PO = '00000000-0000-4000-8000-000000000701';
const PO2 = '00000000-0000-4000-8000-000000000702';
const FOREIGN_PO = '00000000-0000-4000-8000-000000000709';
const LINE = '00000000-0000-4000-8000-000000000801';
function baseDb() {
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{
      id: 'sub-1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {
        purchases: true, purchase_invoices: true, purchase_orders: true, inventory: true,
      } },
    }],
    purchase_invoices: [], purchase_invoice_items: [], disbursement_invoice_items: [],
    purchase_orders: [], purchase_order_items: [],
  } as Record<string, Row[]>;
}
function request(body?: Row, method = 'POST', url = 'http://localhost/api/test') {
  const token = createToken(USER, 'admin');
  return { url, method, headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const rpc = (name: string) => mockDb.rpcCalls.find((call) => call.name === name);
const invoiceBody = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-08-01', supplier_id: SUPPLIER,
  items: [{ description: 'حديد', quantity: 2, unit_price: 100 }], tax_rate: 0.15, notes: 'اختبار', ...overrides,
});
const orderBody = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-08-01', supplier_id: SUPPLIER,
  items: [{ description: 'حديد', quantity: 2, unit_price: 100 }], notes: 'اختبار', ...overrides,
});
beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('purchase invoice atomic boundary', () => {
  test.each([
    [{ quantity: -1, unit_price: 100 }, 'negative quantity'],
    [{ quantity: 1, unit_price: -1 }, 'negative price'],
  ])('rejects %s before the RPC', async (item) => {
    const response = await invoicePOST(request(invoiceBody({ items: [{ description: 'x', ...item }] })));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('delegates canonical calculation inputs with tenant identity and no total parameter', async () => {
    const response = await invoicePOST(request(invoiceBody()));
    expect(response.status).toBe(201);
    expect(rpc('create_purchase_invoice_atomic')!.params).toMatchObject({
      p_company_id: C1, p_user_id: USER, p_supplier_id: SUPPLIER,
      p_items: [{ description: 'حديد', quantity: 2, unit_price: 100 }], p_tax_rate: 0.15,
    });
    expect(rpc('create_purchase_invoice_atomic')!.params).not.toHaveProperty('p_total');
    expect(rpc('create_purchase_invoice_atomic')!.params).toMatchObject({
      p_paid_amount: 0,
      p_bank_safe_id: null,
    });
  });

  test('passes immediate supplier payment into the same invoice RPC', async () => {
    const SAFE = '00000000-0000-4000-8000-0000000000b1';
    const response = await invoicePOST(request(invoiceBody({ paid_amount: 50, bank_safe_id: SAFE })));
    expect(response.status).toBe(201);
    expect(rpc('create_purchase_invoice_atomic')!.params).toMatchObject({
      p_paid_amount: 50,
      p_bank_safe_id: SAFE,
    });
  });

  test('rejects cash payment without a treasury or bank', async () => {
    const response = await invoicePOST(request(invoiceBody({ paid_amount: 50 })));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('الخزينة');
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('metadata update cannot manually manufacture a paid state', async () => {
    const response = await invoicePUT(request({ status: 'paid' }, 'PUT'), params(PI));
    expect(response.status).toBe(409);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('notes use metadata RPC while cancellation and DELETE use the reversal lifecycle', async () => {
    expect((await invoicePUT(request({ notes: 'new' }, 'PUT'), params(PI))).status).toBe(200);
    expect(rpc('update_purchase_invoice_metadata')!.params).toMatchObject({ p_company_id: C1, p_invoice_id: PI, p_user_id: USER });

    mockDb.rpcCalls.length = 0;
    expect((await invoicePUT(request({ status: 'cancelled', notes: 'خطأ' }, 'PUT'), params(PI))).status).toBe(200);
    expect(rpc('cancel_purchase_invoice_atomic')!.params).toMatchObject({ p_company_id: C1, p_invoice_id: PI, p_notes: 'خطأ' });

    mockDb.rpcCalls.length = 0;
    expect((await invoiceDELETE(request(undefined, 'DELETE'), params(PI))).status).toBe(200);
    expect(rpc('cancel_purchase_invoice_atomic')!.params).toMatchObject({ p_company_id: C1, p_invoice_id: PI, p_user_id: USER });
  });
});

describe('purchase order atomic boundary', () => {
  test('valid order passes line inputs—not a caller supplied total—to PostgreSQL', async () => {
    const response = await orderPOST(request(orderBody()));
    expect(response.status).toBe(201);
    expect(rpc('create_purchase_order_atomic')!.params).toMatchObject({
      p_company_id: C1, p_user_id: USER, p_supplier_id: SUPPLIER,
      p_items: [{ description: 'حديد', quantity: 2, unit_price: 100 }],
    });
    expect(rpc('create_purchase_order_atomic')!.params).not.toHaveProperty('p_total');
  });

  test('update is tenant-scoped in the RPC call', async () => {
    const response = await orderPUT(request({ notes: 'updated' }, 'PUT'), params(PO));
    expect(response.status).toBe(200);
    expect(rpc('update_purchase_order_atomic')!.params).toMatchObject({
      p_company_id: C1, p_order_id: PO, p_notes: 'updated', p_user_id: USER,
    });
  });

  test('negative receive quantity is rejected before stock can be touched', async () => {
    const response = await orderPATCH(request({ quantities: { [LINE]: -1 } }, 'PATCH'), params(PO));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
    expect(mockDb.calls.filter((call) => call.mut.kind)).toHaveLength(0);
  });

  test('receipt and cancellation carry trusted company/user into locked RPCs', async () => {
    expect((await orderPATCH(request({ quantities: { [LINE]: 2 }, date: '2026-08-02' }, 'PATCH'), params(PO))).status).toBe(200);
    expect(rpc('receive_purchase_order_atomic')!.params).toMatchObject({
      p_company_id: C1, p_order_id: PO, p_quantities: { [LINE]: 2 }, p_user_id: USER,
    });
    mockDb.rpcCalls.length = 0;
    expect((await orderDELETE(request(undefined, 'DELETE'), params(PO))).status).toBe(200);
    expect(rpc('cancel_purchase_order_atomic')!.params).toMatchObject({ p_company_id: C1, p_order_id: PO, p_user_id: USER });
  });
});

describe('purchase reads remain tenant scoped and batched', () => {
  test('foreign invoice/order ids return 404 because both parent reads filter company_id', async () => {
    mockDb = makeDb({ ...baseDb(),
      purchase_invoices: [{ id: FOREIGN_PI, company_id: 'company-2' }],
      purchase_orders: [{ id: FOREIGN_PO, company_id: 'company-2' }],
    });
    expect((await invoiceGET(request(undefined, 'GET'), params(FOREIGN_PI))).status).toBe(404);
    expect((await orderGET(request(undefined, 'GET'), params(FOREIGN_PO))).status).toBe(404);
    for (const call of mockDb.calls.filter((item) => ['purchase_invoices', 'purchase_orders'].includes(item.table))) {
      expect(call.ops).toContainEqual({ op: 'eq', col: 'company_id', val: C1 });
    }
  });

  test('invoice supplier filter and page-level item query preserve authoritative paid_amount', async () => {
    mockDb = makeDb({ ...baseDb(),
      purchase_invoices: [{ id: PI, company_id: C1, supplier_id: SUPPLIER, date: '2026-08-01', paid_amount: 0 }],
      purchase_invoice_items: [{ id: LINE, company_id: C1, purchase_invoice_id: PI }],
      disbursement_invoice_items: [{ company_id: C1, purchase_invoice_id: PI, amount: 80 }],
    });
    const response = await invoicesGET(request(undefined, 'GET', `http://localhost/api/purchases/invoices?supplierId=${SUPPLIER}`));
    const json = await response.json();
    expect(json.data.invoices[0]).toMatchObject({ id: PI, paid_amount: 0 });
    expect(json.data.invoices[0].items).toHaveLength(1);
    expect(mockDb.calls.filter((call) => call.table === 'purchase_invoice_items')).toHaveLength(1);
  });

  test('orders load children in one page-level query', async () => {
    mockDb = makeDb({ ...baseDb(),
      purchase_orders: [{ id: PO, company_id: C1, date: '2026-08-01' }, { id: PO2, company_id: C1, date: '2026-08-01' }],
      purchase_order_items: [{ id: 'l1', company_id: C1, purchase_order_id: PO }],
    });
    const response = await ordersGET(request(undefined, 'GET'));
    const json = await response.json();
    expect(json.data.orders[0].items).toHaveLength(1);
    expect(mockDb.calls.filter((call) => call.table === 'purchase_order_items')).toHaveLength(1);
  });
});
