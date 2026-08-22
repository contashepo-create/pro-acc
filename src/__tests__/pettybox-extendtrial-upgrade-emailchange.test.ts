/**
 * Route-boundary tests for petty-cash/boxes error branches,
 * admin/companies/[id]/extend-trial error branches, admin/upgrade-requests GET,
 * company/users/[id] PUT email change.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createToken, createAdminToken, hashPassword } from '@/lib/auth';

const sendVerificationEmailMock = jest.fn();
jest.mock('@/lib/email', () => ({ sendVerificationEmail: (...a: any[]) => sendVerificationEmailMock(...a) }));

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
          if (o.op === 'ilike') return String(get(o.col!) ?? '').toLowerCase().includes(String(o.val).toLowerCase());
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

import { POST as boxPOST } from '@/app/api/petty-cash/boxes/route';
import { POST as extendPOST } from '@/app/api/admin/companies/[id]/extend-trial/route';
import { GET as upgGET } from '@/app/api/admin/upgrade-requests/route';
import { PUT as userPUT } from '@/app/api/company/users/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const ID1 = '00000000-0000-4000-8000-0000000000b1';
let masterHash = '';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
function adminReq(method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createAdminToken(A1, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: () => null },
    cookies: { get: (name: string) => name === 'admin_token' ? { value: token } : undefined },
    json: async () => body, text: async () => JSON.stringify(body) } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0, master_password_hash: masterHash }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { petty_cash: true } } }],
    upgrade_requests: [], subscription_plans: [], companies_lookup: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeAll(async () => { masterHash = await hashPassword('master-pass'); });
beforeEach(() => { resetRateLimits(); sendVerificationEmailMock.mockReset(); mockDb = makeDb(baseDb()); });

describe('petty-cash/boxes POST', () => {
  test('rejects invalid input and maps RPC 404', async () => {
    const res1 = await boxPOST(req('admin', 'POST', 'http://localhost/x', { name: '' }));
    expect(res1.status).toBe(400);
    mockDb.rpcResults.set('create_petty_cash_box', { data: null, error: { message: 'غير صالح' } });
    const res2 = await boxPOST(req('admin', 'POST', 'http://localhost/x', { name: 'صندوق' }));
    expect(res2.status).toBe(404);
  });
});

describe('admin/companies/[id]/extend-trial', () => {
  test('maps not-found and conflict errors', async () => {
    mockDb.rpcResults.set('extend_company_trial_atomic', { data: null, error: { message: 'الشركة غير موجودة' } });
    const res1 = await extendPOST(adminReq('POST', 'http://localhost/x', { days: 7, masterPassword: 'master-pass' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('extend_company_trial_atomic', { data: null, error: { message: 'تم التمديد مسبقاً' } });
    const res2 = await extendPOST(adminReq('POST', 'http://localhost/x', { days: 7, masterPassword: 'master-pass' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(409);
  });

  test('requires a valid master password', async () => {
    const res = await extendPOST(adminReq('POST', 'http://localhost/x', { days: 7, masterPassword: 'wrong' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(401);
  });
});

describe('admin/upgrade-requests GET', () => {
  test('lists requests with company/plan/user maps', async () => {
    mockDb = makeDb({ ...baseDb(), upgrade_requests: [{ id: ID1, company_id: C1, user_id: 'u1', requested_plan_id: ID1, status: 'pending' }],
      companies_lookup: [{ id: C1, name: 'شركة' }], subscription_plans: [{ id: ID1, name: 'باقة' }] });
    const res = await upgGET(adminReq('GET', 'http://localhost/api/admin/upgrade-requests'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requests).toHaveLength(1);
  });
});

describe('company/users/[id] PUT email change', () => {
  test('changes the email and flags verification pending', async () => {
    sendVerificationEmailMock.mockResolvedValue(true);
    mockDb = makeDb({ ...baseDb(), users: [
      { id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' },
      { id: ID1, company_id: C1, name: 'موظف', email: 'old@example.com', role: 'accountant', is_active: true, token_version: 0 },
    ] });
    const res = await userPUT(req('admin', 'PUT', 'http://localhost/x', { email: 'new@example.com' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.verificationPending).toBe(true);
  });
});
