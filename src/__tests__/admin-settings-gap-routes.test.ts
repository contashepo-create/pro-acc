/**
 * Route-boundary tests for admin/logout, admin/addon-requests,
 * petty-cash/boxes and admin/activation-codes.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createAdminToken, createToken } from '@/lib/auth';

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
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
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
jest.mock('@/lib/storage-references', () => ({ signPrivateReceiptReference: async () => null }));

import { POST as logoutPOST } from '@/app/api/admin/logout/route';
import { GET as addonGET, PUT as addonPUT } from '@/app/api/admin/addon-requests/route';
import { POST as boxPOST, PUT as boxPUT } from '@/app/api/petty-cash/boxes/route';
import { GET as codesGET, POST as codesPOST } from '@/app/api/admin/activation-codes/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const U1 = '00000000-0000-4000-8000-0000000000u1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const BID = '00000000-0000-4000-8000-0000000000b1';
const CID = '00000000-0000-4000-8000-0000000000c1';

function adminReq(method = 'GET', url = 'http://localhost/x', body?: any, withToken = true) {
  return {
    url, method, nextUrl: new URL(url),
    headers: { get: (k: string) => (k === 'x-master-password' ? null : null) },
    cookies: { get: (name: string) => (withToken && name === 'admin_token' ? { value: createAdminToken(A1, 0) } : undefined) },
    json: async () => body, text: async () => JSON.stringify(body),
  } as any;
}

function userReq(method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken(U1, 'admin', 0);
  return {
    url, method, nextUrl: new URL(url),
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body, text: async () => JSON.stringify(body),
  } as any;
}

const MODULES = { petty_cash: true, contracts: true, subscriptions: true, users: true };

function baseDb() {
  return {
    users: [{ id: U1, company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise', subscription_plans: { code: 'enterprise', features_modules: MODULES } }],
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0 }],
    addon_requests: [], activation_codes: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('admin/logout', () => {
  test('revokes sessions and returns success with a valid token', async () => {
    const res = await logoutPOST(adminReq('POST', 'http://localhost/x'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toContain('تسجيل الخروج');
  });

  test('returns success when there is no admin token', async () => {
    const res = await logoutPOST(adminReq('POST', 'http://localhost/x', undefined, false));
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('returns a server error when the revoke rpc fails', async () => {
    mockDb.rpcResults.set('revoke_admin_sessions', { data: null, error: { message: 'db down' } });
    const res = await logoutPOST(adminReq('POST', 'http://localhost/x'));
    expect(res.status).toBe(500);
  });
});

describe('admin/addon-requests', () => {
  test('GET rejects an invalid status', async () => {
    const res = await addonGET(adminReq('GET', 'http://localhost/addon-requests?status=bogus'));
    expect(res.status).toBe(400);
  });

  test('GET returns requests with an all status', async () => {
    mockDb.db.addon_requests.push({ id: 'r1', company_id: C1, user_id: U1, addon_type: 'extra_user', status: 'pending', receipt_image_url: null });
    const res = await addonGET(adminReq('GET', 'http://localhost/addon-requests?status=all'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.requests.length).toBe(1);
  });

  test('PUT rejects an invalid id', async () => {
    const res = await addonPUT(adminReq('PUT', 'http://localhost/x', { id: 'bad', status: 'approved' }));
    expect(res.status).toBe(400);
  });

  test('PUT rejects an invalid status', async () => {
    const res = await addonPUT(adminReq('PUT', 'http://localhost/x', { id: BID, status: 'pending' }));
    expect(res.status).toBe(400);
  });

  test('PUT maps not-found to 404', async () => {
    mockDb.rpcResults.set('review_addon_request', { data: null, error: { message: 'request not found' } });
    const res = await addonPUT(adminReq('PUT', 'http://localhost/x', { id: BID, status: 'approved' }));
    expect(res.status).toBe(404);
  });

  test('PUT maps already-reviewed to 409', async () => {
    mockDb.rpcResults.set('review_addon_request', { data: null, error: { message: 'already reviewed' } });
    const res = await addonPUT(adminReq('PUT', 'http://localhost/x', { id: BID, status: 'approved' }));
    expect(res.status).toBe(409);
  });

  test('PUT maps missing payment proof to 409', async () => {
    mockDb.rpcResults.set('review_addon_request', { data: null, error: { message: 'requires full amount' } });
    const res = await addonPUT(adminReq('PUT', 'http://localhost/x', { id: BID, status: 'approved' }));
    expect(res.status).toBe(409);
  });

  test('PUT approves a request', async () => {
    mockDb.rpcResults.set('review_addon_request', { data: { id: BID }, error: null });
    const res = await addonPUT(adminReq('PUT', 'http://localhost/x', { id: BID, status: 'approved', admin_notes: 'موافق' }));
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('petty-cash/boxes', () => {
  test('POST rejects an invalid body', async () => {
    const res = await boxPOST(userReq('POST', 'http://localhost/x', { name: '' }));
    expect(res.status).toBe(400);
  });

  test('POST creates a box', async () => {
    mockDb.rpcResults.set('create_petty_cash_box', { data: { id: BID }, error: null });
    const res = await boxPOST(userReq('POST', 'http://localhost/x', { name: 'صندوق أ', initial_balance: 1000, currency: 'SAR' }));
    expect(res.status).toBe(201);
  });

  test('POST maps an invalid-account rpc error to 404', async () => {
    mockDb.rpcResults.set('create_petty_cash_box', { data: null, error: { message: 'حساب غير صالح' } });
    const res = await boxPOST(userReq('POST', 'http://localhost/x', { name: 'صندوق' }));
    expect(res.status).toBe(404);
  });

  test('PUT reconcile requires a physical count', async () => {
    const res = await boxPUT(userReq('PUT', 'http://localhost/x', { box_id: BID, action: 'reconcile' }));
    expect(res.status).toBe(400);
  });

  test('PUT reconciles a box', async () => {
    mockDb.rpcResults.set('reconcile_petty_cash_box', { data: { system_balance: 100, physical_count: 95, difference: -5, status: 'reconciled' }, error: null });
    const res = await boxPUT(userReq('PUT', 'http://localhost/x', { box_id: BID, action: 'reconcile', physical_count: 95 }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.difference).toBe(-5);
  });

  test('PUT reconcile maps not-found to 404', async () => {
    mockDb.rpcResults.set('reconcile_petty_cash_box', { data: null, error: { message: 'غير موجود' } });
    const res = await boxPUT(userReq('PUT', 'http://localhost/x', { box_id: BID, action: 'reconcile', physical_count: 95 }));
    expect(res.status).toBe(404);
  });

  test('PUT closes a box', async () => {
    mockDb.rpcResults.set('close_petty_cash_box', { data: { id: BID }, error: null });
    const res = await boxPUT(userReq('PUT', 'http://localhost/x', { box_id: BID, action: 'close' }));
    const body = await res.json();
    expect(body.data.closed).toBe(true);
  });

  test('PUT close maps non-zero balance to 409', async () => {
    mockDb.rpcResults.set('close_petty_cash_box', { data: null, error: { message: 'رصيد غير صفري' } });
    const res = await boxPUT(userReq('PUT', 'http://localhost/x', { box_id: BID, action: 'close' }));
    expect(res.status).toBe(409);
  });
});

describe('admin/activation-codes', () => {
  test('GET rejects an invalid used filter', async () => {
    const res = await codesGET(adminReq('GET', 'http://localhost/codes?used=yes'));
    expect(res.status).toBe(400);
  });

  test('GET returns masked codes', async () => {
    mockDb.db.activation_codes.push({ id: 'c1', code: 'AABBCCDD-EEFF0011-22334455-66778899', plan_code: 'enterprise', is_used: false, target_company_id: null, used_by: null });
    const res = await codesGET(adminReq('GET', 'http://localhost/codes?used=false'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.codes[0].code).toContain('••••-');
  });

  test('POST rejects missing planCode and durationMonths', async () => {
    const res = await codesPOST(adminReq('POST', 'http://localhost/x', { notes: 'x' }));
    expect(res.status).toBe(400);
  });

  test('POST rejects an invalid addon quantity', async () => {
    const res = await codesPOST(adminReq('POST', 'http://localhost/x', { addonType: 'extra_user', addonQuantity: 0 }));
    expect(res.status).toBe(400);
  });

  test('POST creates a plan code', async () => {
    const res = await codesPOST(adminReq('POST', 'http://localhost/x', { planCode: 'enterprise', durationMonths: 12 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.codes.length).toBe(1);
  });

  test('POST maps a missing target company to 404', async () => {
    mockDb.rpcResults.set('create_activation_code_batch_atomic', { data: null, error: { message: 'company not found' } });
    const res = await codesPOST(adminReq('POST', 'http://localhost/x', { planCode: 'enterprise', durationMonths: 12, companyId: CID }));
    expect(res.status).toBe(404);
  });

  test('POST maps an unavailable plan to 404', async () => {
    mockDb.rpcResults.set('create_activation_code_batch_atomic', { data: null, error: { message: 'plan is unavailable' } });
    const res = await codesPOST(adminReq('POST', 'http://localhost/x', { planCode: 'enterprise', durationMonths: 12 }));
    expect(res.status).toBe(404);
  });
});
