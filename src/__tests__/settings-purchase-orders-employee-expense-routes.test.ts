/**
 * Route-boundary tests for settings (GET), purchases/orders,
 * employees/[id], project-expenses/[id].
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
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: (payload: Row | Row[]) => { db[table] = [...(db[table] || []), ...(Array.isArray(payload) ? payload : [payload])]; return api; },
      update: () => api, delete: () => api,
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

import { GET as setGET } from '@/app/api/settings/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as poGET, POST as poPOST } from '@/app/api/purchases/orders/route';
import { GET as empGET, PUT as empPUT, DELETE as empDELETE } from '@/app/api/employees/[id]/route';
import { GET as peGET, PUT as pePUT } from '@/app/api/project-expenses/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';
const ID2 = '00000000-0000-4000-8000-00000000f0f2';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة', vat_rate: 0.15 }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { purchases: true, employees: true, projects: true } } }],
    settings: [], purchase_orders: [], purchase_order_items: [], employees: [], project_expenses: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('settings GET', () => {
  test('returns settings and company info', async () => {
    mockDb = makeDb({ ...baseDb(), settings: [{ company_id: C1, key: 'theme', value: '"dark"' }] });
    const res = await setGET(req('admin', 'GET', 'http://localhost/api/settings'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.theme).toBe('dark');
    expect(json.data.company.name).toBe('شركة');
  });
});

describe('purchases/orders', () => {
  test('GET lists orders with items', async () => {
    mockDb = makeDb({ ...baseDb(), purchase_orders: [{ id: ID1, company_id: C1, contacts: { name: 'مورد' } }],
      purchase_order_items: [{ id: 'it1', purchase_order_id: ID1, company_id: C1, description: 'بند' }] });
    const res = await poGET(req('admin', 'GET', 'http://localhost/api/purchases/orders'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.orders[0].supplier_name).toBe('مورد');
    expect(json.data.orders[0].items).toHaveLength(1);
  });

  test('GET rejects an invalid status', async () => {
    const res = await poGET(req('admin', 'GET', 'http://localhost/api/purchases/orders?status=bogus'));
    expect(res.status).toBe(400);
  });

  test('POST creates a purchase order', async () => {
    mockDb.rpcResults.set('create_purchase_order_atomic', { data: { id: ID1 }, error: null });
    const res = await poPOST(req('admin', 'POST', 'http://localhost/x', {
      date: '2026-01-01', supplier_id: ID1, items: [{ description: 'بند', quantity: 1, unit_price: 100 }],
    }));
    expect(res.status).toBe(201);
  });
});

describe('employees/[id]', () => {
  test('GET returns an employee and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), employees: [{ id: ID1, company_id: C1, name: 'موظف' }] });
    const res = await empGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const res2 = await empGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res2.status).toBe(404);
  });

  test('PUT updates an employee', async () => {
    mockDb = makeDb({ ...baseDb(), employees: [{ id: ID1, company_id: C1, name: 'موظف' }] });
    mockDb.rpcResults.set('update_employee_atomic', { data: { id: ID1 }, error: null });
    const res = await empPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'موظف ب' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE deactivates an employee', async () => {
    mockDb = makeDb({ ...baseDb(), employees: [{ id: ID1, company_id: C1, name: 'موظف', is_active: true }] });
    mockDb.rpcResults.set('deactivate_employee_atomic', { data: { id: ID1 }, error: null });
    const res = await empDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('project-expenses/[id]', () => {
  test('GET returns an expense and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), project_expenses: [{ id: ID1, company_id: C1, description: 'مصروف' }] });
    const res = await peGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const res2 = await peGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res2.status).toBe(404);
  });

  test('PUT updates the expense note', async () => {
    mockDb = makeDb({ ...baseDb(), project_expenses: [{ id: ID1, company_id: C1, description: 'مصروف' }] });
    mockDb.rpcResults.set('update_project_expense_note_atomic', { data: { id: ID1 }, error: null });
    const res = await pePUT(req('admin', 'PUT', 'http://localhost/x', { notes: 'ملاحظة' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});
