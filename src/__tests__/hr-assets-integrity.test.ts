/** Tenant and RPC boundaries for employees, advances, payroll, and assets. */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Array<{ op: string; col?: string; val?: any }>; mut?: string }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const from = (table: string) => {
    const ops: Array<{ op: string; col?: string; val?: any }> = [];
    const call = { table, ops, mut: undefined as string | undefined }; calls.push(call);
    const rows = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'gte') return String(row[op.col!]) >= String(op.val);
      if (op.op === 'lte') return String(row[op.col!]) <= String(op.val);
      return true;
    }));
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      gte: (col: string, val: any) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: any) => { ops.push({ op: 'lte', col, val }); return api; },
      order: () => api, range: () => api, limit: () => api, is: () => api,
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
      if (name === 'post_payroll_batch') return { data: { records: [{ id: RESULT }] }, error: null };
      if (name === 'depreciate_fixed_assets_batch') return { data: { count: 1, totalDepreciation: 10, entries: [] }, error: null };
      return { data: { id: RESULT }, error: null };
    },
  };
}
let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as employeePOST } from '@/app/api/employees/route';
import { GET as employeeGET, PUT as employeePUT, DELETE as employeeDELETE } from '@/app/api/employees/[id]/route';
import { POST as advancePOST } from '@/app/api/employee-advances/route';
import { PUT as advancePUT, DELETE as advanceDELETE } from '@/app/api/employee-advances/[id]/route';
import { POST as payrollPOST } from '@/app/api/payroll/route';
import { POST as assetPOST } from '@/app/api/fixed-assets/route';
import { PUT as assetPUT, DELETE as assetDELETE } from '@/app/api/fixed-assets/[id]/route';
import { POST as depreciationPOST } from '@/app/api/fixed-assets/depreciate/route';

const C1 = 'company-1'; const C2 = 'company-2'; const USER = 'u1';
const EMPLOYEE = '00000000-0000-4000-8000-000000000101';
const FOREIGN_EMPLOYEE = '00000000-0000-4000-8000-000000000109';
const ADVANCE = '00000000-0000-4000-8000-000000000201';
const BANK = '00000000-0000-4000-8000-000000000301';
const ASSET = '00000000-0000-4000-8000-000000000401';
const FOREIGN_ASSET = '00000000-0000-4000-8000-000000000409';
const RESULT = '00000000-0000-4000-8000-000000000999';

function seed() {
  const plan = { code: 'enterprise', max_users: 10, max_projects: null, max_clients: null,
    max_suppliers: null, max_employees: 100, max_invoices_per_month: null,
    max_quotations_per_month: null, max_storage_mb: 0, max_branches: 1,
    features_modules: { employees: true, employee_advances: true, payroll: true, fixed_assets: true } };
  return {
    users: [{ id: USER, company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 'sub', company_id: C1, status: 'active', end_date: '2099-01-01', plan_id: 'p1',
      extra_users: 0, extra_branches: 0, extra_storage_gb: 0, subscription_plans: plan }],
    employees: [
      { id: EMPLOYEE, company_id: C1, name: 'Own', salary: 100, hire_date: '2026-01-01', is_active: true },
      { id: FOREIGN_EMPLOYEE, company_id: C2, name: 'Foreign', salary: 100, hire_date: '2026-01-01', is_active: true },
    ],
    employee_advances: [{ id: ADVANCE, company_id: C1, employee_id: EMPLOYEE, amount: 20,
      remaining_amount: 20, date: '2026-01-01', status: 'paid', employees: { name: 'Own' } }],
    fixed_assets: [
      { id: ASSET, company_id: C1, name: 'Asset', code: 'A1', purchase_cost: 100, accumulated_depreciation: 0, status: 'active' },
      { id: FOREIGN_ASSET, company_id: C2, name: 'Foreign', code: 'F1', purchase_cost: 100, accumulated_depreciation: 0, status: 'active' },
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

describe('employee boundaries', () => {
  test('strict create delegates plan-safe insertion with session identity', async () => {
    const body = { name: 'موظف', phone: '', email: '', salary: 100, department: '', position: '', hire_date: '2026-08-01' };
    expect((await employeePOST(request({ ...body, company_id: C2 }))).status).toBe(400);
    expect((await employeePOST(request(body))).status).toBe(201);
    expect(rpc('create_employee_atomic')!.params).toMatchObject({
      p_company_id: C1, p_name: 'موظف', p_salary: 100, p_user_id: USER,
    });
  });

  test('foreign record is hidden and never reaches a writer', async () => {
    expect((await employeeGET(request(undefined, 'GET'), context(FOREIGN_EMPLOYEE))).status).toBe(404);
    expect((await employeePUT(request({ salary: 1 }, 'PUT'), context(FOREIGN_EMPLOYEE))).status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('update and deactivation are audited RPC-only operations', async () => {
    expect((await employeePUT(request({ salary: 120 }, 'PUT'), context(EMPLOYEE))).status).toBe(200);
    expect(rpc('update_employee_atomic')!.params).toEqual({
      p_company_id: C1, p_employee_id: EMPLOYEE, p_patch: { salary: 120 }, p_user_id: USER,
    });
    mockDb.rpcCalls.length = 0;
    expect((await employeeDELETE(request(undefined, 'DELETE'), context(EMPLOYEE))).status).toBe(200);
    expect(rpc('deactivate_employee_atomic')!.params).toMatchObject({ p_company_id: C1, p_employee_id: EMPLOYEE, p_user_id: USER });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });
});

describe('advance and payroll boundaries', () => {
  test('advance creation requires a safe and trusts no tenant fields', async () => {
    const body = { employee_id: EMPLOYEE, amount: 20, date: '2026-08-01', reason: 'سلفة', bank_safe_id: BANK };
    expect((await advancePOST(request({ ...body, created_by: 'foreign' }))).status).toBe(400);
    expect((await advancePOST(request(body))).status).toBe(201);
    expect(rpc('create_employee_advance')!.params).toMatchObject({
      p_company_id: C1, p_employee_id: EMPLOYEE, p_bank_safe_id: BANK, p_created_by: USER,
    });
  });

  test('advance correction and cancellation cannot directly mutate money', async () => {
    expect((await advancePUT(request({ amount: 1, reason: 'bad' }, 'PUT'), context(ADVANCE))).status).toBe(400);
    expect((await advancePUT(request({ reason: 'تصحيح' }, 'PUT'), context(ADVANCE))).status).toBe(200);
    expect(rpc('update_employee_advance_note_atomic')!.params).toMatchObject({
      p_company_id: C1, p_advance_id: ADVANCE, p_user_id: USER,
    });
    mockDb.rpcCalls.length = 0;
    expect((await advanceDELETE(request(undefined, 'DELETE'), context(ADVANCE))).status).toBe(200);
    expect(rpc('cancel_employee_advance_atomic')!.params).toMatchObject({ p_company_id: C1, p_advance_id: ADVANCE, p_user_id: USER });
  });

  test('payroll rejects duplicate IDs then posts one tenant-bound batch', async () => {
    const duplicated = { date: '2026-08-01', employee_ids: [EMPLOYEE, EMPLOYEE] };
    expect((await payrollPOST(request(duplicated))).status).toBe(400);
    expect((await payrollPOST(request({ date: '2026-08-01', employee_ids: [EMPLOYEE] }))).status).toBe(201);
    expect(rpc('post_payroll_batch')!.params).toEqual({
      p_company_id: C1, p_date: '2026-08-01', p_employee_ids: [EMPLOYEE], p_created_by: USER,
    });
  });
});

describe('fixed asset boundaries', () => {
  const createBody = { name: 'آلة', code: 'M1', category: 'equipment', purchase_date: '2026-08-01',
    purchase_cost: 100, useful_life_years: 5, depreciation_method: 'straight_line', location: '', notes: '', bank_safe_id: BANK };

  test('asset creation is strict and atomic with its acquisition entry', async () => {
    expect((await assetPOST(request({ ...createBody, depreciation_rate: 99 }))).status).toBe(400);
    expect((await assetPOST(request(createBody))).status).toBe(201);
    expect(rpc('create_fixed_asset')!.params).toMatchObject({
      p_company_id: C1, p_code: 'M1', p_bank_safe_id: BANK, p_created_by: USER,
    });
  });

  test('foreign asset metadata is hidden', async () => {
    expect((await assetPUT(request({ notes: 'cross' }, 'PUT'), context(FOREIGN_ASSET))).status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('metadata and disposal use audited atomic functions only', async () => {
    expect((await assetPUT(request({ notes: 'updated' }, 'PUT'), context(ASSET))).status).toBe(200);
    expect(rpc('update_fixed_asset_metadata_atomic')!.params).toMatchObject({
      p_company_id: C1, p_asset_id: ASSET, p_user_id: USER,
    });
    mockDb.rpcCalls.length = 0;
    expect((await assetDELETE(request(undefined, 'DELETE'), context(ASSET))).status).toBe(200);
    expect(rpc('dispose_fixed_asset_atomic')!.params).toMatchObject({ p_company_id: C1, p_asset_id: ASSET, p_user_id: USER });
    expect(mockDb.calls.filter((call) => call.mut)).toHaveLength(0);
  });

  test('monthly depreciation is one database batch transaction', async () => {
    expect((await depreciationPOST(request())).status).toBe(200);
    expect(rpc('depreciate_fixed_assets_batch')!.params).toMatchObject({ p_company_id: C1, p_user_id: USER });
  });
});
