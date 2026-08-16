/** Tenant, strict-input, and RPC-only boundaries for project delivery operations. */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; mut?: string; ops: Array<{ col: string; val: any }> }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const from = (table: string) => {
    const call = { table, mut: undefined as string | undefined, ops: [] as Array<{ col: string; val: any }> }; calls.push(call);
    const rows = () => (db[table] || []).filter((row) => call.ops.every((op) => row[op.col] === op.val));
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { call.ops.push({ col, val }); return api; },
      in: () => api, gte: () => api, lte: () => api, neq: () => api,
      order: () => api, range: () => api, limit: () => api,
      insert: () => { call.mut = 'insert'; return api; },
      update: () => { call.mut = 'update'; return api; },
      delete: () => { call.mut = 'delete'; return api; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: (ok: any, fail: any) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok, fail),
    };
    return api;
  };
  return {
    from, calls, rpcCalls,
    rpc: async (name: string, params: any) => {
      rpcCalls.push({ name, params });
      return { data: { id: RESULT, status: name.includes('cancel') ? 'cancelled' : 'active' }, error: null };
    },
  };
}
let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as projectPOST } from '@/app/api/projects/route';
import { GET as projectGET } from '@/app/api/projects/[id]/route';
import { POST as boqPOST } from '@/app/api/boq/route';
import { PUT as boqPUT } from '@/app/api/boq/[id]/route';
import { POST as changePOST } from '@/app/api/change-orders/route';
import { PATCH as changePATCH } from '@/app/api/change-orders/[id]/route';
import { PUT as expensePUT, DELETE as expenseDELETE } from '@/app/api/project-expenses/[id]/route';
import { POST as billingPOST } from '@/app/api/progress-billing/route';
import { PUT as billingPUT } from '@/app/api/progress-billing/[id]/route';
import { POST as equipmentPOST } from '@/app/api/equipment/route';
import { PUT as equipmentPUT, DELETE as equipmentDELETE } from '@/app/api/equipment/[id]/route';
import { POST as maintenancePOST } from '@/app/api/equipment/[id]/maintenance/route';
import { POST as workerPOST } from '@/app/api/daily-workers/route';
import { PUT as workerPUT, DELETE as workerDELETE } from '@/app/api/daily-workers/[id]/route';

const C1 = 'company-1'; const C2 = 'company-2'; const USER = 'u1';
const PROJECT = '10000000-0000-4000-8000-000000000001';
const FOREIGN_PROJECT = '10000000-0000-4000-8000-000000000002';
const BOQ = '20000000-0000-4000-8000-000000000001';
const FOREIGN_BOQ = '20000000-0000-4000-8000-000000000002';
const CHANGE = '30000000-0000-4000-8000-000000000001';
const FOREIGN_CHANGE = '30000000-0000-4000-8000-000000000002';
const EXPENSE = '40000000-0000-4000-8000-000000000001';
const FOREIGN_EXPENSE = '40000000-0000-4000-8000-000000000002';
const CLAIM = '50000000-0000-4000-8000-000000000001';
const EQUIPMENT = '60000000-0000-4000-8000-000000000001';
const FOREIGN_EQUIPMENT = '60000000-0000-4000-8000-000000000002';
const WORKER = '70000000-0000-4000-8000-000000000001';
const FOREIGN_WORKER = '70000000-0000-4000-8000-000000000002';
const RESULT = '90000000-0000-4000-8000-000000000001';

function seed() {
  const plan = { code: 'enterprise', max_users: 100, max_projects: 100, max_clients: 100, max_suppliers: 100,
    max_employees: 100, max_invoices_per_month: 1000, max_quotations_per_month: 1000,
    max_storage_mb: 1000, max_branches: 10,
    features_modules: { projects: true, boq: true, project_expenses: true, progress_billing: true,
      equipment: true, fixed_assets: true, employees: true } };
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 'sub', company_id: C1, status: 'active', end_date: '2099-01-01', plan_id: 'p1',
      extra_users: 0, extra_branches: 0, extra_storage_gb: 0, subscription_plans: plan }],
    projects: [
      { id: PROJECT, company_id: C1, name: 'Own', status: 'active', claim_number: '1', is_final: false },
      { id: FOREIGN_PROJECT, company_id: C2, name: 'Foreign', status: 'active' },
    ],
    boq_items: [
      { id: BOQ, project_id: PROJECT, company_id: C1, description: 'Own' },
      { id: FOREIGN_BOQ, project_id: FOREIGN_PROJECT, company_id: C2, description: 'Foreign' },
    ],
    change_orders: [
      { id: CHANGE, project_id: PROJECT, company_id: C1, status: 'draft' },
      { id: FOREIGN_CHANGE, project_id: FOREIGN_PROJECT, company_id: C2, status: 'draft' },
    ],
    project_expenses: [
      { id: EXPENSE, project_id: PROJECT, company_id: C1, status: 'approved', notes: '' },
      { id: FOREIGN_EXPENSE, project_id: FOREIGN_PROJECT, company_id: C2, status: 'approved' },
    ],
    progress_billing: [{ id: CLAIM, project_id: PROJECT, company_id: C1, claim_number: '1', description: '', is_final: false }],
    equipment: [
      { id: EQUIPMENT, company_id: C1, name: 'Own machine', status: 'available' },
      { id: FOREIGN_EQUIPMENT, company_id: C2, name: 'Foreign machine', status: 'available' },
    ],
    daily_workers: [
      { id: WORKER, company_id: C1, name: 'Own worker', daily_wage: 100, is_active: true },
      { id: FOREIGN_WORKER, company_id: C2, name: 'Foreign worker', daily_wage: 100, is_active: true },
    ],
  } as Record<string, Row[]>;
}
function request(body?: any, method = 'POST') {
  const token = createToken(USER, 'admin');
  return { url: 'http://localhost/api/test', method,
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const rpc = (name: string) => mockDb.rpcCalls.find((call) => call.name === name);
beforeEach(() => { mockDb = makeDb(seed()); });

describe('project and BOQ boundaries', () => {
  test('project creation rejects tenant injection and delegates one atomic write', async () => {
    const body = { name: 'New', client_id: null, contract_value: 1000, start_date: '2026-08-01', items: [] };
    expect((await projectPOST(request({ ...body, company_id: C2 }))).status).toBe(400);
    expect((await projectPOST(request(body))).status).toBe(201);
    expect(rpc('create_project_atomic')!.params).toMatchObject({ p_company_id: C1, p_name: 'New', p_user_id: USER });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });

  test('a foreign project and foreign BOQ item are hidden', async () => {
    expect((await projectGET(request(undefined, 'GET'), context(FOREIGN_PROJECT))).status).toBe(404);
    expect((await boqPUT(request({ description: 'cross' }, 'PUT'), context(FOREIGN_BOQ))).status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('BOQ creation is strict and RPC-only', async () => {
    const body = { project_id: PROJECT, item_code: 'B-1', description: 'Concrete', unit: 'm3', quantity: 2, unit_price: 50 };
    expect((await boqPOST(request({ ...body, total: 1 }))).status).toBe(400);
    expect((await boqPOST(request(body))).status).toBe(201);
    expect(rpc('create_boq_item_atomic')!.params).toMatchObject({ p_company_id: C1, p_project_id: PROJECT, p_item_code: 'B-1', p_user_id: USER });
  });
});

describe('change order, expense, and billing lifecycles', () => {
  test('change orders cannot start approved and foreign orders never reach an RPC', async () => {
    const body = { project_id: PROJECT, title: 'Variation', change_amount: 25, status: 'approved' };
    expect((await changePOST(request(body))).status).toBe(400);
    expect((await changePOST(request({ ...body, status: 'submitted' }))).status).toBe(201);
    expect(rpc('create_change_order_atomic')!.params).toMatchObject({ p_company_id: C1, p_project_id: PROJECT, p_user_id: USER });
    mockDb.rpcCalls.length = 0;
    expect((await changePATCH(request({ title: 'cross' }, 'PATCH'), context(FOREIGN_CHANGE))).status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('posted expense money is immutable while notes and cancellation are RPC-only', async () => {
    expect((await expensePUT(request({ amount: 1 }, 'PUT'), context(EXPENSE))).status).toBe(400);
    expect((await expensePUT(request({ notes: 'metadata' }, 'PUT'), context(EXPENSE))).status).toBe(200);
    expect(rpc('update_project_expense_note_atomic')!.params).toMatchObject({ p_company_id: C1, p_expense_id: EXPENSE, p_user_id: USER });
    mockDb.rpcCalls.length = 0;
    expect((await expenseDELETE(request(undefined, 'DELETE'), context(EXPENSE))).status).toBe(200);
    expect(rpc('cancel_project_expense')!.params).toMatchObject({ p_company_id: C1, p_expense_id: EXPENSE, p_user_id: USER });
    mockDb.rpcCalls.length = 0;
    expect((await expensePUT(request({ notes: 'cross' }, 'PUT'), context(FOREIGN_EXPENSE))).status).toBe(404);
  });

  test('billing calculation fields cannot be edited after creation', async () => {
    const create = { project_id: PROJECT, date: '2026-08-01', gross_amount: 100, retention_rate: 0.1, tax_rate: 0.15 };
    expect((await billingPOST(request(create))).status).toBe(201);
    expect(rpc('create_progress_billing_atomic')!.params).toMatchObject({ p_company_id: C1, p_gross_amount: 100, p_user_id: USER });
    expect((await billingPUT(request({ gross_amount: 1 }, 'PUT'), context(CLAIM))).status).toBe(400);
    expect((await billingPUT(request({ status: 'cancelled' }, 'PUT'), context(CLAIM))).status).toBe(200);
    expect(rpc('cancel_progress_billing_atomic')!.params).toMatchObject({ p_company_id: C1, p_claim_id: CLAIM, p_user_id: USER });
  });
});

describe('operational equipment and daily labour boundaries', () => {
  test('equipment creation, maintenance, and retirement are audited RPC operations', async () => {
    expect((await equipmentPOST(request({ name: 'Loader', type: 'heavy', company_id: C2 }))).status).toBe(400);
    expect((await equipmentPOST(request({ name: 'Loader', type: 'heavy' }))).status).toBe(201);
    expect(rpc('create_equipment_atomic')!.params).toMatchObject({ p_company_id: C1, p_user_id: USER });
    expect((await maintenancePOST(request({ maintenance_date: '2026-08-01', description: 'Service', cost: 10 }), context(EQUIPMENT))).status).toBe(201);
    expect(rpc('record_equipment_maintenance_atomic')!.params).toMatchObject({ p_company_id: C1, p_equipment_id: EQUIPMENT, p_user_id: USER });
    expect((await equipmentDELETE(request(undefined, 'DELETE'), context(EQUIPMENT))).status).toBe(200);
    expect(rpc('decommission_equipment_atomic')!.params).toMatchObject({ p_company_id: C1, p_equipment_id: EQUIPMENT, p_user_id: USER });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });

  test('foreign equipment is hidden from writes', async () => {
    expect((await equipmentPUT(request({ location: 'cross' }, 'PUT'), context(FOREIGN_EQUIPMENT))).status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('daily workers use strict RPC-only creation, updates, and deactivation', async () => {
    expect((await workerPOST(request({ name: 'Worker', daily_wage: 100, company_id: C2 }))).status).toBe(400);
    expect((await workerPOST(request({ name: 'Worker', daily_wage: 100 }))).status).toBe(201);
    expect(rpc('create_daily_worker_atomic')!.params).toMatchObject({ p_company_id: C1, p_daily_wage: 100, p_user_id: USER });
    expect((await workerPUT(request({ daily_wage: 110 }, 'PUT'), context(WORKER))).status).toBe(200);
    expect(rpc('update_daily_worker_atomic')!.params).toMatchObject({ p_company_id: C1, p_worker_id: WORKER, p_user_id: USER });
    expect((await workerDELETE(request(undefined, 'DELETE'), context(WORKER))).status).toBe(200);
    expect(rpc('deactivate_daily_worker_atomic')!.params).toMatchObject({ p_company_id: C1, p_worker_id: WORKER, p_user_id: USER });
    mockDb.rpcCalls.length = 0;
    expect((await workerPUT(request({ daily_wage: 1 }, 'PUT'), context(FOREIGN_WORKER))).status).toBe(404);
  });
});
