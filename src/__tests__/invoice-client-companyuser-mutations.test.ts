/**
 * Route-boundary tests for invoices/[id] immutability (no PUT) + PATCH cancel,
 * clients/[id] PUT/DELETE, company/users/[id] DELETE.
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
          const get = (col: string): unknown => {
            let cur: unknown = r;
            for (const k of col.split('.')) {
              if (cur == null) break;
              cur = (cur as Record<string, unknown>)[k];
            }
            return cur;
          };
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(get(o.col!));
          if (o.op === 'ilike') return String(get(o.col!) ?? '').toLowerCase().includes(String(o.val).toLowerCase());
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      ilike: (col: string, val: unknown) => { ops.push({ op: 'ilike', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
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
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import * as invRoute from '@/app/api/invoices/[id]/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { PUT as clPUT, DELETE as clDELETE } from '@/app/api/clients/[id]/route';
import { DELETE as cuDELETE } from '@/app/api/company/users/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { invoices: true, clients: true, contacts: true } } }],
    invoices: [], contacts: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('invoices/[id] immutability (المحور الثاني)', () => {
  test('لا يوجد مسار تعديل (PUT) للفاتورة نهائياً — البديل الإشعارات الدائنة/المدينة', async () => {
    expect((invRoute as Record<string, unknown>).PUT).toBeUndefined();
    expect(typeof invRoute.GET).toBe('function');
    // الإلغاء فقط مسموح عبر PATCH
    expect(typeof invRoute.PATCH).toBe('function');
  });

  test('PATCH يرفض أي حالة غير الإلغاء', async () => {
    const res1 = await invRoute.PATCH(req('admin', 'PATCH', 'http://localhost/x', { status: 'paid' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res1.status).toBe(400);
    const res2 = await invRoute.PATCH(req('admin', 'PATCH', 'http://localhost/x', { status: 'partial' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(400);
  });

  test('PATCH يلغي الفاتورة عبر cancel_sales_invoice_atomic', async () => {
    mockDb.rpcResults.set('cancel_sales_invoice_atomic', { data: { id: ID1 }, error: null });
    const res = await invRoute.PATCH(req('admin', 'PATCH', 'http://localhost/x', { status: 'cancelled' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('clients/[id]', () => {
  test('PUT updates a client and rejects an invalid type', async () => {
    mockDb.rpcResults.set('update_contact_atomic', { data: { id: ID1 }, error: null });
    const res = await clPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'عميل ب' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const res2 = await clPUT(req('admin', 'PUT', 'http://localhost/x', { type: 'supplier' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(400);
  });

  test('PUT maps plan-limit error to 403', async () => {
    mockDb.rpcResults.set('update_contact_atomic', { data: null, error: { message: 'contact plan limit: clients' } });
    const res = await clPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'x' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(403);
  });

  test('DELETE deactivates a client', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: ID1, company_id: C1, type: 'client' }] });
    mockDb.rpcResults.set('deactivate_contact_atomic', { data: { id: ID1 }, error: null });
    const res = await clDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE returns 404 when missing', async () => {
    const res = await clDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });
});

describe('company/users/[id] DELETE', () => {
  test('rejects deleting your own account', async () => {
    const res = await cuDELETE(req('admin', 'DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: 'u1' }) });
    expect(res.status).toBe(400);
  });

  test('deactivates another user and maps not-found', async () => {
    mockDb.rpcResults.set('deactivate_company_user_atomic', { data: { id: ID1 }, error: null });
    const res = await cuDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    mockDb.rpcResults.set('deactivate_company_user_atomic', { data: null, error: { message: 'غير موجود' } });
    const res2 = await cuDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(404);
  });
});
