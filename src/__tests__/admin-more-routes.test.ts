/**
 * Route-boundary tests for additional superadmin routes:
 * /api/admin/payment-methods, /api/admin/app-settings/[key],
 * /api/admin/subscription-plans/[id].
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createAdminToken, hashPassword } from '@/lib/auth';

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
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: () => api, order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: (payload: any) => { db[table] = [...(db[table] || []), payload]; return api; },
      update: () => api, delete: () => api,
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

import { GET as pmGET, POST as pmPOST, PUT as pmPUT, DELETE as pmDELETE } from '@/app/api/admin/payment-methods/route';
import { PUT as settingsPUT, DELETE as settingsDELETE } from '@/app/api/admin/app-settings/[key]/route';
import { PUT as planPUT, DELETE as planDELETE } from '@/app/api/admin/subscription-plans/[id]/route';

const A1 = '00000000-0000-4000-8000-0000000000a1';
const PID = '00000000-0000-4000-8000-0000000000b1';
let masterHash = '';

function adminReq(method = 'GET', url = 'http://localhost/x', body?: any, master?: string) {
  const token = createAdminToken(A1, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'x-master-password' ? (master ?? null) : null },
    cookies: { get: (name: string) => name === 'admin_token' ? { value: token } : undefined },
    json: async () => body, text: async () => JSON.stringify(body) } as any;
}

function baseDb() {
  return {
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0, master_password_hash: masterHash }],
    payment_methods: [], admin_audit_log: [], app_settings: [],
  } as Record<string, Row[]>;
}

beforeAll(async () => { masterHash = await hashPassword('master-pass'); });
beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('admin/payment-methods', () => {
  test('GET lists payment methods', async () => {
    mockDb = makeDb({ ...baseDb(), payment_methods: [{ id: PID, code: 'bank', name_ar: 'تحويل', is_active: true }] });
    const res = await pmGET(adminReq('GET', 'http://localhost/api/admin/payment-methods'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.methods).toHaveLength(1);
  });

  test('POST creates a payment method', async () => {
    mockDb.rpcResults.set('admin_manage_payment_method', { data: { id: PID }, error: null });
    const res = await pmPOST(adminReq('POST', 'http://localhost/x', { code: 'bank_transfer', name_ar: 'تحويل بنكي' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects an invalid code', async () => {
    const res = await pmPOST(adminReq('POST', 'http://localhost/x', { code: 'BAD!', name_ar: 'x' }));
    expect(res.status).toBe(400);
  });

  test('PUT updates a payment method', async () => {
    mockDb.rpcResults.set('admin_manage_payment_method', { data: { id: PID }, error: null });
    const res = await pmPUT(adminReq('PUT', 'http://localhost/x', { id: PID, name_ar: 'محدث' }));
    expect(res.status).toBe(200);
  });

  test('PUT returns 404 when not found', async () => {
    mockDb.rpcResults.set('admin_manage_payment_method', { data: { not_found: true }, error: null });
    const res = await pmPUT(adminReq('PUT', 'http://localhost/x', { id: PID, name_ar: 'محدث' }));
    expect(res.status).toBe(404);
  });

  test('DELETE deactivates a payment method', async () => {
    mockDb.rpcResults.set('admin_manage_payment_method', { data: { deleted: true }, error: null });
    const res = await pmDELETE(adminReq('DELETE', `http://localhost/x?id=${PID}`));
    expect(res.status).toBe(200);
  });
});

describe('admin/app-settings/[key]', () => {
  test('PUT updates a setting', async () => {
    mockDb.rpcResults.set('admin_update_app_setting', { data: { key: 'x' }, error: null });
    const res = await settingsPUT(adminReq('PUT', 'http://localhost/x', { value: 'v' }), { params: Promise.resolve({ key: 'maintenance_mode' }) });
    expect(res.status).toBe(200);
  });

  test('PUT rejects an unsafe key', async () => {
    const res = await settingsPUT(adminReq('PUT', 'http://localhost/x', { value: 'v' }), { params: Promise.resolve({ key: 'BAD KEY' }) });
    expect(res.status).toBe(400);
  });

  test('PUT returns 404 when the setting is not found', async () => {
    mockDb.rpcResults.set('admin_update_app_setting', { data: { not_found: true }, error: null });
    const res = await settingsPUT(adminReq('PUT', 'http://localhost/x', { value: 'v' }), { params: Promise.resolve({ key: 'custom_key' }) });
    expect(res.status).toBe(404);
  });

  test('DELETE removes a custom setting', async () => {
    mockDb.rpcResults.set('admin_delete_app_setting', { data: { deleted: true }, error: null });
    const res = await settingsDELETE(adminReq('DELETE', 'http://localhost/x'), { params: Promise.resolve({ key: 'custom_key' }) });
    expect(res.status).toBe(200);
  });

  test('DELETE rejects a protected built-in setting', async () => {
    mockDb.rpcResults.set('admin_delete_app_setting', { data: { protected: true }, error: null });
    const res = await settingsDELETE(adminReq('DELETE', 'http://localhost/x'), { params: Promise.resolve({ key: 'built_in' }) });
    expect(res.status).toBe(400);
  });
});

describe('admin/subscription-plans/[id]', () => {
  test('PUT updates a plan', async () => {
    mockDb.rpcResults.set('admin_manage_subscription_plan', { data: { id: PID }, error: null });
    const res = await planPUT(adminReq('PUT', 'http://localhost/x', { name: 'باقة جديدة' }), { params: Promise.resolve({ id: PID }) });
    expect(res.status).toBe(200);
  });

  test('PUT rejects an invalid id', async () => {
    const res = await planPUT(adminReq('PUT', 'http://localhost/x', { name: 'x' }), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('PUT rejects invalid plan input', async () => {
    const res = await planPUT(adminReq('PUT', 'http://localhost/x', { code: 'B!' }), { params: Promise.resolve({ id: PID }) });
    expect(res.status).toBe(400);
  });

  test('DELETE removes an unused plan with master password', async () => {
    mockDb.rpcResults.set('delete_unused_subscription_plan_atomic', { data: { deleted: true }, error: null });
    const res = await planDELETE(adminReq('DELETE', 'http://localhost/x', undefined, 'master-pass'), { params: Promise.resolve({ id: PID }) });
    expect(res.status).toBe(200);
  });

  test('DELETE requires master password', async () => {
    const res = await planDELETE(adminReq('DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: PID }) });
    expect(res.status).toBe(401);
  });
});
