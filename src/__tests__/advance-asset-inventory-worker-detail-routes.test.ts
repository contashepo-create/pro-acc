/**
 * Route-boundary tests for employee-advances/[id], fixed-assets/[id],
 * inventory/[id], daily-workers/[id], inventory-transactions/[id],
 * projects/costs, projects/overhead.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown }>();
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

import { GET as advGET, PUT as advPUT, DELETE as advDELETE } from '@/app/api/employee-advances/[id]/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as faGET, PUT as faPUT, DELETE as faDELETE } from '@/app/api/fixed-assets/[id]/route';
import { GET as invGET, PUT as invPUT } from '@/app/api/inventory/[id]/route';
import { GET as dwGET, PUT as dwPUT, DELETE as dwDELETE } from '@/app/api/daily-workers/[id]/route';
import { GET as itxGET, PUT as itxPUT } from '@/app/api/inventory-transactions/[id]/route';
import { GET as pcGET } from '@/app/api/projects/costs/route';
import { GET as ohGET, POST as ohPOST } from '@/app/api/projects/overhead/route';
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
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { employees: true, fixed_assets: true, inventory: true, projects: true } } }],
    employee_advances: [], fixed_assets: [], inventory_items: [], daily_workers: [],
    inventory_transactions: [], overhead_allocations: [], projects: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('employee-advances/[id]', () => {
  test('GET returns an advance and 404 when missing', async () => {
    mockDb = makeDb({ ...baseDb(), employee_advances: [{ id: ID1, company_id: C1, employees: { name: 'موظف' } }] });
    const res = await advGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.employee_name).toBe('موظف');
    const res2 = await advGET(req('admin', 'GET', `http://localhost/x/${ID2}`), { params: Promise.resolve({ id: ID2 }) });
    expect(res2.status).toBe(404);
  });

  test('PUT updates the advance note', async () => {
    mockDb = makeDb({ ...baseDb(), employee_advances: [{ id: ID1, company_id: C1 }] });
    mockDb.rpcResults.set('update_employee_advance_note_atomic', { data: { id: ID1 }, error: null });
    const res = await advPUT(req('admin', 'PUT', 'http://localhost/x', { reason: 'تعديل' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE cancels an advance', async () => {
    mockDb = makeDb({ ...baseDb(), employee_advances: [{ id: ID1, company_id: C1 }] });
    mockDb.rpcResults.set('cancel_employee_advance_atomic', { data: { id: ID1 }, error: null });
    const res = await advDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('fixed-assets/[id]', () => {
  test('GET returns an asset with net book value', async () => {
    mockDb = makeDb({ ...baseDb(), fixed_assets: [{ id: ID1, company_id: C1, purchase_cost: 1000, accumulated_depreciation: 200 }] });
    const res = await faGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.net_book_value).toBe(800);
  });

  test('PUT updates an asset', async () => {
    mockDb = makeDb({ ...baseDb(), fixed_assets: [{ id: ID1, company_id: C1 }] });
    mockDb.rpcResults.set('update_fixed_asset_metadata_atomic', { data: { id: ID1 }, error: null });
    const res = await faPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'أصل' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE disposes an asset', async () => {
    mockDb = makeDb({ ...baseDb(), fixed_assets: [{ id: ID1, company_id: C1 }] });
    mockDb.rpcResults.set('dispose_fixed_asset_atomic', { data: { id: ID1 }, error: null });
    const res = await faDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('inventory/[id]', () => {
  test('GET returns an item with warehouse name', async () => {
    mockDb = makeDb({ ...baseDb(), inventory_items: [{ id: ID1, company_id: C1, name: 'صنف', warehouses: { name: 'مخزن' } }] });
    const res = await invGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.warehouse_name).toBe('مخزن');
  });

  test('PUT updates an item and rejects quantity changes', async () => {
    mockDb = makeDb({ ...baseDb(), inventory_items: [{ id: ID1, company_id: C1, name: 'صنف' }] });
    mockDb.rpcResults.set('update_inventory_item_atomic', { data: { id: ID1 }, error: null });
    const res = await invPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'صنف ب' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const res2 = await invPUT(req('admin', 'PUT', 'http://localhost/x', { quantity: 5 }), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(400);
  });
});

describe('daily-workers/[id]', () => {
  test('GET returns a worker', async () => {
    mockDb = makeDb({ ...baseDb(), daily_workers: [{ id: ID1, company_id: C1, name: 'عامل' }] });
    const res = await dwGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT updates a worker', async () => {
    mockDb = makeDb({ ...baseDb(), daily_workers: [{ id: ID1, company_id: C1, name: 'عامل' }] });
    mockDb.rpcResults.set('update_daily_worker_atomic', { data: { id: ID1 }, error: null });
    const res = await dwPUT(req('admin', 'PUT', 'http://localhost/x', { name: 'عامل ب' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE deactivates a worker', async () => {
    mockDb = makeDb({ ...baseDb(), daily_workers: [{ id: ID1, company_id: C1, name: 'عامل' }] });
    mockDb.rpcResults.set('deactivate_daily_worker_atomic', { data: { id: ID1 }, error: null });
    const res = await dwDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('inventory-transactions/[id]', () => {
  test('GET returns a transaction', async () => {
    mockDb = makeDb({ ...baseDb(), inventory_transactions: [{ id: ID1, company_id: C1 }] });
    const res = await itxGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('PUT updates transaction notes', async () => {
    mockDb.rpcResults.set('update_inventory_transaction_note_atomic', { data: { id: ID1 }, error: null });
    const res = await itxPUT(req('admin', 'PUT', 'http://localhost/x', { notes: 'ملاحظة' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('projects/costs GET', () => {
  test('returns an empty cost breakdown for a project', async () => {
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1 }], journal_lines: [] });
    const res = await pcGET(req('admin', 'GET', `http://localhost/api/projects/costs?projectId=${ID1}`));
    expect(res.status).toBe(200);
  });

  test('rejects a missing projectId', async () => {
    const res = await pcGET(req('admin', 'GET', 'http://localhost/api/projects/costs'));
    expect(res.status).toBe(400);
  });
});

describe('projects/overhead', () => {
  test('GET lists overhead allocations', async () => {
    mockDb = makeDb({ ...baseDb(), overhead_allocations: [{ id: ID1, company_id: C1, name: 'قاعدة' }] });
    const res = await ohGET(req('admin', 'GET', 'http://localhost/api/projects/overhead'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rows).toHaveLength(1);
  });

  test('POST creates an overhead allocation', async () => {
    const res = await ohPOST(req('admin', 'POST', 'http://localhost/x', { name: 'قاعدة', allocation_basis: 'direct_cost', rate: 0.05 }));

    expect(res.status).toBe(201);
  });

  test('POST rejects missing fields and duplicate names', async () => {
    const res1 = await ohPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res1.status).toBe(400);
    mockDb = makeDb({ ...baseDb(), overhead_allocations: [{ id: ID1, company_id: C1, name: 'قاعدة' }] });
    const res2 = await ohPOST(req('admin', 'POST', 'http://localhost/x', { name: 'قاعدة', allocation_basis: 'direct_cost', rate: 0.05 }));
    expect(res2.status).toBe(409);
  });
});
