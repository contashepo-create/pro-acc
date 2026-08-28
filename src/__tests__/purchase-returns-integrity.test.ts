/** مرتجع المشتريات: نسخ البنود من الفاتورة، والرد النقدي، والإلغاء الذري. */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcCalls: Array<{ name: string; params?: Row }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'in') return (op.val as unknown[]).includes(row[op.col!]);
      if (op.op === 'is') return op.val === null ? row[op.col!] == null : row[op.col!] === op.val;
      return true;
    }));
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      is: (col: string, val: unknown) => { ops.push({ op: 'is', col, val }); return api; },
      neq: () => api, or: () => api, order: () => api, limit: () => api, range: () => api, gte: () => api,
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
    from, calls, rpcCalls, rpcResults,
    rpc: async (name: string, params?: Row): Promise<{ data: unknown; error: unknown }> => {
      rpcCalls.push({ name, params });
      return rpcResults.get(name) || { data: { id: `${name}-id`, status: 'approved' }, error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as returnsGET, POST as returnsPOST } from '@/app/api/purchases/returns/route';
import { GET as returnGET, DELETE as returnDELETE } from '@/app/api/purchases/returns/[id]/route';

const C1 = 'company-1';
const USER = 'u1';
const PI = '00000000-0000-4000-8000-000000000601';
const RET = '00000000-0000-4000-8000-000000000901';
const SAFE = '00000000-0000-4000-8000-0000000000b1';
const SUPPLIER = '00000000-0000-4000-8000-000000000501';

function baseDb() {
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{
      id: 'sub-1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { purchases: true, purchase_invoices: true } },
    }],
    purchase_invoices: [{ id: PI, company_id: C1, number: 12, invoice_number: 12, supplier_id: SUPPLIER }],
    purchase_invoice_items: [{ id: 'l1', company_id: C1, purchase_invoice_id: PI, description: 'حديد', quantity: 2, unit_price: 100 }],
    purchase_returns: [],
    purchase_return_items: [],
    contacts: [{ id: SUPPLIER, company_id: C1, name: 'مورد' }],
  } as Record<string, Row[]>;
}

function request(body?: Row, method = 'POST', url = 'http://localhost/api/purchases/returns') {
  const token = createToken(USER, 'admin');
  return {
    url, method,
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('purchase returns API', () => {
  test('copies invoice lines when the body omits items', async () => {
    const res = await returnsPOST(request({
      purchase_invoice_id: PI, reason: 'تلف', date: '2026-08-02',
    }));
    expect(res.status).toBe(201);
    expect(mockDb.rpcCalls[0]).toMatchObject({
      name: 'create_purchase_return_atomic',
      params: {
        p_company_id: C1,
        p_purchase_invoice_id: PI,
        p_items: [{ description: 'حديد', quantity: 2, unit_price: 100 }],
        p_refund_amount: 0,
      },
    });
  });

  test('passes optional supplier refund into the atomic call', async () => {
    const res = await returnsPOST(request({
      purchase_invoice_id: PI, reason: 'تلف', date: '2026-08-02',
      items: [{ description: 'حديد', quantity: 1, unit_price: 100 }],
      refund_amount: 115, bank_safe_id: SAFE,
    }));
    expect(res.status).toBe(201);
    expect(mockDb.rpcCalls[0].params).toMatchObject({
      p_refund_amount: 115,
      p_bank_safe_id: SAFE,
    });
  });

  test('rejects a cash refund without a treasury', async () => {
    const res = await returnsPOST(request({
      purchase_invoice_id: PI, reason: 'تلف', date: '2026-08-02',
      items: [{ description: 'حديد', quantity: 1, unit_price: 100 }],
      refund_amount: 10,
    }));
    expect(res.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('lists tenant returns with supplier names', async () => {
    mockDb = makeDb({
      ...baseDb(),
      purchase_returns: [{ id: RET, company_id: C1, purchase_invoice_id: PI, total: 230, deleted_at: null }],
    });
    const res = await returnsGET(request(undefined, 'GET'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.returns[0]).toMatchObject({ id: RET, supplier_name: 'مورد', invoice_number: 12 });
  });

  test('cancels through one tenant-scoped RPC', async () => {
    const res = await returnDELETE(request(undefined, 'DELETE'), { params: Promise.resolve({ id: RET }) });
    expect(res.status).toBe(200);
    expect(mockDb.rpcCalls[0]).toMatchObject({
      name: 'cancel_purchase_return_atomic',
      params: { p_company_id: C1, p_return_id: RET, p_user_id: USER },
    });
  });

  test('detail GET is tenant scoped', async () => {
    mockDb = makeDb({
      ...baseDb(),
      purchase_returns: [{ id: RET, company_id: C1, purchase_invoice_id: PI }],
      purchase_return_items: [{ id: 'ri1', company_id: C1, purchase_return_id: RET, description: 'حديد' }],
    });
    const res = await returnGET(request(undefined, 'GET'), { params: Promise.resolve({ id: RET }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.items).toHaveLength(1);
  });
});

describe('migration 109 cash-at-issue SQL', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '109-invoice-cash-at-issue-and-returns.sql'), 'utf8');

  test('purchase invoice wrapper pays after withholding and rejects custody plus cash', () => {
    expect(sql).toContain('p_paid_amount NUMERIC DEFAULT 0');
    expect(sql).toContain('لا يجتمع السداد النقدي مع سداد العهدة على نفس الفاتورة');
    expect(sql).toContain("create_voucher_disbursement_atomic(");
    expect(sql).toContain("'supplier'");
  });

  test('credit note refund lowers paid_amount and cancel restores it after voucher reverse', () => {
    expect(sql).toContain("create_voucher_disbursement_atomic(");
    expect(sql).toContain("'client_refund'");
    expect(sql).toContain('GREATEST(0,COALESCE(v_invoice.paid_amount,0)-v_refund)');
    expect(sql).toContain('cancel_voucher_disbursement_atomic');
    expect(sql).toContain('invoice_net_total(p_company_id,id)');
  });

  test('purchase return and disbursement remaining net of returned_amount', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS purchase_returns');
    expect(sql).toContain('FUNCTION public.create_purchase_return_atomic');
    expect(sql).toContain("'supplier_refund'");
    expect(sql).toContain('ROUND(v_invoice.total-COALESCE(v_invoice.returned_amount,0),2)');
  });
});
