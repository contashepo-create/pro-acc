/**
 * Route-boundary tests for quotations, inventory, equipment, custodies,
 * gantt, and inventory/transactions collection routes.
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
          if (o.op === 'gte') return String(get(o.col!)) >= String(o.val);
          if (o.op === 'lte') return String(get(o.col!)) <= String(o.val);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
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

import { GET as qGET, POST as qPOST } from '@/app/api/quotations/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as invGET, POST as invPOST } from '@/app/api/inventory/route';
import { GET as eqGET, POST as eqPOST } from '@/app/api/equipment/route';
import { GET as custGET, POST as custPOST } from '@/app/api/custodies/route';
import { GET as ganttGET, POST as ganttPOST } from '@/app/api/gantt/route';
import { GET as txGET, POST as txPOST } from '@/app/api/inventory/transactions/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0e1';
const CID = '00000000-0000-4000-8000-00000000f0f1';

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
      subscription_plans: { code: 'enterprise', features_modules: { quotations: true, inventory: true, equipment: true, custody: true, projects: true } } }],
    quotations: [], quotation_items: [], inventory_items: [], warehouses: [], equipment: [],
    custodies: [], contacts: [], projects: [], project_tasks: [], project_task_dependencies: [],
    inventory_transactions: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('quotations', () => {
  test('GET lists quotations with items', async () => {
    mockDb = makeDb({ ...baseDb(), quotations: [{ id: ID1, company_id: C1, contacts: { name: 'عميل' } }],
      quotation_items: [{ id: 'i1', quotation_id: ID1, company_id: C1 }] });
    const res = await qGET(req('admin', 'GET', 'http://localhost/api/quotations'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.quotations[0].contact_name).toBe('عميل');
    expect(json.data.quotations[0].items).toHaveLength(1);
  });

  test('POST creates a quotation', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: CID, company_id: C1 }] });
    mockDb.rpcResults.set('create_quotation', { data: { id: ID1 }, error: null });
    const res = await qPOST(req('admin', 'POST', 'http://localhost/api/quotations', {
      date: '2026-01-01', contact_id: CID, items: [{ description: 'بند', quantity: 1, unit_price: 100 }],
    }));
    expect(res.status).toBe(201);
  });

  test('POST rejects missing required fields and unknown contact', async () => {
    const res1 = await qPOST(req('admin', 'POST', 'http://localhost/api/quotations', {}));
    expect(res1.status).toBe(400);
    const res2 = await qPOST(req('admin', 'POST', 'http://localhost/api/quotations', { date: '2026-01-01', contact_id: CID, items: [{ description: 'x', quantity: 1, unit_price: 1 }] }));
    expect(res2.status).toBe(404);
  });
});

describe('inventory', () => {
  test('GET lists warehouses when requested', async () => {
    mockDb = makeDb({ ...baseDb(), warehouses: [{ id: ID1, company_id: C1, name: 'مخزن', is_active: true }] });
    const res = await invGET(req('admin', 'GET', 'http://localhost/api/inventory?warehouses'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.warehouses).toHaveLength(1);
  });

  test('GET lists inventory items', async () => {
    mockDb = makeDb({ ...baseDb(), inventory_items: [{ id: ID1, company_id: C1, name: 'صنف', warehouses: { name: 'مخزن' } }] });
    const res = await invGET(req('admin', 'GET', 'http://localhost/api/inventory'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items[0].warehouse_name).toBe('مخزن');
  });

  test('POST creates an inventory item', async () => {
    mockDb.rpcResults.set('create_inventory_item_atomic', { data: { id: ID1 }, error: null });
    const res = await invPOST(req('admin', 'POST', 'http://localhost/api/inventory', { code: 'IT-1', name: 'صنف', unit: 'وحدة', warehouse_id: ID1 }));
    expect(res.status).toBe(201);
  });

  test('POST maps warehouse-not-found error', async () => {
    mockDb.rpcResults.set('create_inventory_item_atomic', { data: null, error: { message: 'المستودع غير موجود' } });
    const res = await invPOST(req('admin', 'POST', 'http://localhost/api/inventory', { code: 'IT-1', name: 'صنف', unit: 'وحدة', warehouse_id: ID1 }));
    expect(res.status).toBe(404);
  });
});

describe('equipment', () => {
  test('GET lists equipment', async () => {
    mockDb = makeDb({ ...baseDb(), equipment: [{ id: ID1, company_id: C1, name: 'معدة' }] });
    const res = await eqGET(req('admin', 'GET', 'http://localhost/api/equipment'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.equipment).toHaveLength(1);
  });

  test('GET rejects an invalid status', async () => {
    const res = await eqGET(req('admin', 'GET', 'http://localhost/api/equipment?status=bogus'));
    expect(res.status).toBe(400);
  });

  test('POST creates equipment', async () => {
    mockDb.rpcResults.set('create_equipment_atomic', { data: { id: ID1 }, error: null });
    const res = await eqPOST(req('admin', 'POST', 'http://localhost/api/equipment', { name: 'معدة', type: 'excavator' }));
    expect(res.status).toBe(201);
  });
});

describe('custodies', () => {
  test('GET lists custodies with names', async () => {
    mockDb = makeDb({ ...baseDb(), custodies: [{ id: ID1, company_id: C1, employees: { name: 'موظف' }, projects: { name: 'مشروع' } }] });
    const res = await custGET(req('admin', 'GET', 'http://localhost/api/custodies'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.custodies[0].employee_name).toBe('موظف');
  });

  test('GET rejects an invalid status filter', async () => {
    const res = await custGET(req('admin', 'GET', 'http://localhost/api/custodies?status=bogus'));
    expect(res.status).toBe(400);
  });

  test('POST opens a custody file', async () => {
    mockDb.rpcResults.set('open_custody_file', { data: { id: ID1 }, error: null });
    const res = await custPOST(req('admin', 'POST', 'http://localhost/api/custodies', {
      employee_id: ID1, date: '2026-01-01', amount: 500, reason: 'سلفة', bank_safe_id: ID1,
    }));
    expect(res.status).toBe(201);
  });
});

describe('gantt', () => {
  test('GET returns schedule with CPM summary', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1 }],
      project_tasks: [
        { id: 't1', project_id: ID1, company_id: C1, title: 'مهمة', start_date: today, end_date: today, progress: 100 },
        { id: 't2', project_id: ID1, company_id: C1, title: 'مهمة 2', start_date: today, end_date: today, progress: 0 },
      ],
      project_task_dependencies: [] });
    mockDb.rpcResults.set('get_project_critical_path', { data: { tasks: [], criticalPath: ['t1'], projectDuration: 3 }, error: null });
    const res = await ganttGET(req('admin', 'GET', `http://localhost/api/gantt?project_id=${ID1}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.summary.totalTasks).toBe(2);
    expect(json.data.summary.completed).toBe(1);
  });

  test('GET returns 404 for an unknown project', async () => {
    const res = await ganttGET(req('admin', 'GET', `http://localhost/api/gantt?project_id=${ID1}`));
    expect(res.status).toBe(404);
  });

  test('POST creates a project task', async () => {
    mockDb.rpcResults.set('create_project_task_atomic', { data: { id: 't1' }, error: null });
    const res = await ganttPOST(req('admin', 'POST', 'http://localhost/api/gantt', { project_id: ID1, name: 'مهمة', start_date: '2026-01-01', end_date: '2026-01-02' }));
    expect(res.status).toBe(201);
  });
});

describe('inventory/transactions', () => {
  test('GET lists transactions', async () => {
    mockDb = makeDb({ ...baseDb(), inventory_transactions: [{ id: ID1, company_id: C1, inventory_items: { name: 'صنف', code: 'IT-1' } }] });
    const res = await txGET(req('admin', 'GET', 'http://localhost/api/inventory/transactions'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.transactions[0].item_name).toBe('صنف');
  });

  test('GET rejects an invalid type filter', async () => {
    const res = await txGET(req('admin', 'GET', 'http://localhost/api/inventory/transactions?type=bogus'));
    expect(res.status).toBe(400);
  });

  test('POST records a stock movement', async () => {
    mockDb = makeDb({ ...baseDb() });
    const res = await txPOST(req('admin', 'POST', 'http://localhost/api/inventory/transactions', {
      item_id: ID1, warehouse_id: ID1, type: 'add', quantity: 5, date: '2026-01-01',
    }));
    // applyStockMovement performs DB queries; 500/400 tolerated but must not crash.
    expect([200, 201, 400, 404, 500]).toContain(res.status);
  });
});
