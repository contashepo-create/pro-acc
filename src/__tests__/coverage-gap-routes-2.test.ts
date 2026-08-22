/**
 * Route-boundary tests for admin companies/app-settings/payment-methods and
 * company/users/[id] routes (round 2 of coverage gaps).
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createAdminToken, createToken, hashPassword } from '@/lib/auth';

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
          if (o.op === 'ilike') return String(get(o.col!)).toLowerCase().includes(String(o.val).toLowerCase().replace(/^%|%$/g, ''));
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      ilike: (col: string, val: any) => { ops.push({ op: 'ilike', col, val }); return api; },
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
    from, calls, rpcResults, db,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));
jest.mock('@/lib/email', () => ({ sendVerificationEmail: async () => true }));

import { POST as toggleCompanyPOST } from '@/app/api/admin/companies/toggle-status/route';
import { GET as adminAppGet, PUT as adminAppPut } from '@/app/api/admin/app-settings/route';
import { GET as payMGet, POST as payMPost, PUT as payMPut, DELETE as payMDelete } from '@/app/api/admin/payment-methods/route';
import { GET as cuGet, PUT as cuPut, DELETE as cuDelete } from '@/app/api/company/users/[id]/route';
import { PATCH as userPATCH } from '@/app/api/admin/users/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const U1 = '00000000-0000-4000-8000-0000000000u1';
const U2 = '00000000-0000-4000-8000-0000000000b2';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const CID = '00000000-0000-4000-8000-0000000000c1';
const PMID = '00000000-0000-4000-8000-0000000000c1';

function userReq(method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken(U1, 'admin', 0);
  return {
    url, method, nextUrl: new URL(url),
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body, text: async () => JSON.stringify(body),
  } as any;
}

let masterHash = '';
function adminReq(method = 'GET', url = 'http://localhost/x', body?: any, master?: string) {
  const token = createAdminToken(A1, 0);
  return {
    url, method, nextUrl: new URL(url),
    headers: { get: (k: string) => (k === 'x-master-password' ? (master ?? null) : null) },
    cookies: { get: (name: string) => (name === 'admin_token' ? { value: token } : undefined) },
    json: async () => body, text: async () => JSON.stringify(body),
  } as any;
}

const MODULES = { equipment: true, reports: true, settings: true, accounts: true, users: true, subscriptions: true };

function baseDb() {
  return {
    users: [
      { id: U1, company_id: C1, name: 'مدير', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' },
      { id: U2, company_id: C1, name: 'موظف', email: 'emp@example.com', is_active: true, token_version: 0, role: 'accountant' },
    ],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise', subscription_plans: { code: 'enterprise', features_modules: MODULES } }],
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0, master_password_hash: masterHash }],
    app_settings: [], payment_methods: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeAll(async () => {
  masterHash = await hashPassword('master-pass');
});

beforeEach(() => {
  resetRateLimits();
  mockDb = makeDb(baseDb());
});

describe('admin/companies/toggle-status', () => {
  test('rejects a missing master password header', async () => {
    const res = await toggleCompanyPOST(adminReq('POST', 'http://localhost/x', {}, undefined));
    expect(res.status).toBe(401);
  });

  test('rejects an invalid payload', async () => {
    const res = await toggleCompanyPOST(adminReq('POST', 'http://localhost/x', { companyId: 'x', is_active: 'yes' }, 'master-pass'));
    expect(res.status).toBe(400);
  });

  test('rejects an invalid company id', async () => {
    const res = await toggleCompanyPOST(adminReq('POST', 'http://localhost/x', { companyId: 'bad', is_active: true }, 'master-pass'));
    expect(res.status).toBe(400);
  });

  test('toggles a company status successfully', async () => {
    const res = await toggleCompanyPOST(adminReq('POST', 'http://localhost/x', { companyId: CID, is_active: true }, 'master-pass'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toContain('تفعيل');
  });

  test('maps not-found RPC error to 404', async () => {
    mockDb.rpcResults.set('set_company_status_atomic', { data: null, error: { message: 'الشركة غير موجودة' } });
    const res = await toggleCompanyPOST(adminReq('POST', 'http://localhost/x', { companyId: CID, is_active: true }, 'master-pass'));
    expect(res.status).toBe(404);
  });
});

describe('admin/app-settings', () => {
  test('GET returns settings', async () => {
    mockDb.db.app_settings.push({ key: 'app_name', value: 'برو', category: 'general' });
    const res = await adminAppGet(adminReq('GET', 'http://localhost/x'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.app_name).toBe('برو');
  });

  test('PUT rejects an invalid key', async () => {
    const res = await adminAppPut(adminReq('PUT', 'http://localhost/x', { 'Bad Key!': 'x' }));
    expect(res.status).toBe(400);
  });

  test('PUT rejects an invalid value type', async () => {
    const res = await adminAppPut(adminReq('PUT', 'http://localhost/x', { app_name: { nested: true } }));
    expect(res.status).toBe(400);
  });

  test('PUT returns updated:0 for an empty payload', async () => {
    const res = await adminAppPut(adminReq('PUT', 'http://localhost/x', {}));
    const body = await res.json();
    expect(body.data.updated).toBe(0);
  });

  test('PUT applies updates via rpc', async () => {
    mockDb.rpcResults.set('admin_upsert_app_settings', { data: { updated: 2 } });
    const res = await adminAppPut(adminReq('PUT', 'http://localhost/x', { app_name: 'برو', footer_text: 'شكراً' }));
    const body = await res.json();
    expect(body.data.updated).toBe(2);
  });
});

describe('admin/payment-methods', () => {
  test('GET returns payment methods', async () => {
    mockDb.db.payment_methods.push({ id: PMID, code: 'card', name_ar: 'بطاقة', sort_order: 1 });
    const res = await payMGet(adminReq('GET', 'http://localhost/x'));
    const body = await res.json();
    expect(body.data.methods.length).toBe(1);
  });

  test('POST rejects an invalid code', async () => {
    const res = await payMPost(adminReq('POST', 'http://localhost/x', { code: 'X!' }));
    expect(res.status).toBe(400);
  });

  test('POST rejects a missing arabic name', async () => {
    const res = await payMPost(adminReq('POST', 'http://localhost/x', { code: 'card' }));
    expect(res.status).toBe(400);
  });

  test('POST creates a payment method', async () => {
    mockDb.rpcResults.set('admin_manage_payment_method', { data: { id: PMID } });
    const res = await payMPost(adminReq('POST', 'http://localhost/x', { code: 'card', name_ar: 'بطاقة', sort_order: 2 }));
    expect(res.status).toBe(201);
  });

  test('PUT rejects an invalid id', async () => {
    const res = await payMPut(adminReq('PUT', 'http://localhost/x', { id: 'bad' }));
    expect(res.status).toBe(400);
  });

  test('PUT updates a payment method', async () => {
    mockDb.rpcResults.set('admin_manage_payment_method', { data: { id: PMID } });
    const res = await payMPut(adminReq('PUT', 'http://localhost/x', { id: PMID, name_ar: 'بطاقة جديدة' }));
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('PUT maps not-found to 404', async () => {
    mockDb.rpcResults.set('admin_manage_payment_method', { data: { not_found: true } });
    const res = await payMPut(adminReq('PUT', 'http://localhost/x', { id: PMID, name_ar: 'بطاقة' }));
    expect(res.status).toBe(404);
  });

  test('DELETE rejects an invalid id', async () => {
    const res = await payMDelete(adminReq('DELETE', 'http://localhost/x?'));
    expect(res.status).toBe(400);
  });

  test('DELETE deactivates a payment method', async () => {
    mockDb.rpcResults.set('admin_manage_payment_method', { data: { id: PMID } });
    const res = await payMDelete(adminReq('DELETE', 'http://localhost/x?id=' + PMID));
    const body = await res.json();
    expect(body.data.deactivated).toBe(true);
  });
});

describe('company/users/[id]', () => {
  test('GET returns the user details', async () => {
    const res = await cuGet(userReq('GET', 'http://localhost/x'), { params: Promise.resolve({ id: U2 }) });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('emp@example.com');
  });

  test('GET returns 404 for a missing user', async () => {
    const res = await cuGet(userReq('GET', 'http://localhost/x'), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000099' }) });
    expect(res.status).toBe(404);
  });

  test('PUT blocks changing your own role away from admin', async () => {
    const res = await cuPut(userReq('PUT', 'http://localhost/x', { role: 'accountant' }), { params: Promise.resolve({ id: U1 }) });
    expect(res.status).toBe(400);
  });

  test('PUT blocks deactivating your own account', async () => {
    const res = await cuPut(userReq('PUT', 'http://localhost/x', { is_active: false }), { params: Promise.resolve({ id: U1 }) });
    expect(res.status).toBe(400);
  });

  test('PUT rejects an invalid email format', async () => {
    const res = await cuPut(userReq('PUT', 'http://localhost/x', { email: 'not-an-email' }), { params: Promise.resolve({ id: U2 }) });
    expect(res.status).toBe(400);
  });

  test('PUT updates name and phone and audits', async () => {
    const res = await cuPut(userReq('PUT', 'http://localhost/x', { name: 'الموظف', phone: '0100000' }), { params: Promise.resolve({ id: U2 }) });
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('DELETE blocks deleting your own account', async () => {
    const res = await cuDelete(userReq('DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: U1 }) });
    expect(res.status).toBe(400);
  });

  test('DELETE deactivates another user', async () => {
    mockDb.rpcResults.set('deactivate_company_user_atomic', { data: { id: U2 } });
    const res = await cuDelete(userReq('DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: U2 }) });
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('DELETE maps not-found to 404', async () => {
    mockDb.rpcResults.set('deactivate_company_user_atomic', { data: null, error: { message: 'المستخدم غير موجود' } });
    const res = await cuDelete(userReq('DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: U2 }) });
    expect(res.status).toBe(404);
  });

  test('DELETE maps last-manager to 409', async () => {
    mockDb.rpcResults.set('deactivate_company_user_atomic', { data: null, error: { message: 'لا يمكن حذف آخر مدير' } });
    const res = await cuDelete(userReq('DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: U2 }) });
    expect(res.status).toBe(409);
  });
});

describe('admin/users/[id] PATCH extra branches', () => {
  test('rejects a wrong master password', async () => {
    const res = await userPATCH(adminReq('PATCH', 'http://localhost/x', { is_active: true }, 'wrong'), { params: Promise.resolve({ id: U2 }) });
    expect(res.status).toBe(401);
  });

  test('maps last-manager RPC error to 409', async () => {
    mockDb.rpcResults.set('set_company_user_status_atomic', { data: null, error: { message: 'لا يمكن إيقاف آخر مدير' } });
    const res = await userPATCH(adminReq('PATCH', 'http://localhost/x', { is_active: false }, 'master-pass'), { params: Promise.resolve({ id: U2 }) });
    expect(res.status).toBe(409);
  });
});
