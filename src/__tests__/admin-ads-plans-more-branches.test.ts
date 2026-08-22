/**
 * Route-boundary tests for admin/advertisements more branches and
 * admin/subscription-plans/[id] error branches.
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
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as adsGET, POST as adsPOST, PATCH as adsPATCH, DELETE as adsDELETE } from '@/app/api/admin/advertisements/route';
import { PUT as planPUT, DELETE as planDELETE } from '@/app/api/admin/subscription-plans/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const A1 = '00000000-0000-4000-8000-0000000000a1';
const ID1 = '00000000-0000-4000-8000-0000000000b1';

function adminReq(method = 'GET', url = 'http://localhost/x', body?: any, master?: string) {
  const token = createAdminToken(A1, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'x-master-password' ? (master ?? null) : null },
    cookies: { get: (name: string) => name === 'admin_token' ? { value: token } : undefined },
    json: async () => body, text: async () => JSON.stringify(body) } as any;
}

let masterHash = '';

function baseDb() {
  return {
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0, master_password_hash: masterHash }],
    advertisements: [], subscription_plans: [],
  } as Record<string, Row[]>;
}

beforeAll(async () => { masterHash = await hashPassword('master-pass'); });
beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('admin/advertisements more branches', () => {
  test('GET filters by active=false and q', async () => {
    mockDb = makeDb({ ...baseDb(), advertisements: [{ id: ID1, title: 'إعلان', body: 'نص', type: 'banner', display_mode: 'top_bar', priority: 1, is_active: false }] });
    const res = await adsGET(adminReq('GET', 'http://localhost/api/admin/advertisements?active=false&q=إعلان'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  test('POST rejects invalid priority, expiresAt and showDuration', async () => {
    const res1 = await adsPOST(adminReq('POST', 'http://localhost/x', { title: 't', body: 'b', type: 'banner', display_mode: 'top_bar', priority: 9999 }));
    expect(res1.status).toBe(400);
    const res2 = await adsPOST(adminReq('POST', 'http://localhost/x', { title: 't', body: 'b', type: 'banner', display_mode: 'top_bar', expiresAt: 'bad' }));
    expect(res2.status).toBe(400);
    const res3 = await adsPOST(adminReq('POST', 'http://localhost/x', { title: 't', body: 'b', type: 'banner', display_mode: 'top_bar', showDuration: 0 }));
    expect(res3.status).toBe(400);
  });

  test('POST creates an ad with showDuration', async () => {
    mockDb.rpcResults.set('admin_manage_advertisement', { data: { id: ID1 }, error: null });
    const res = await adsPOST(adminReq('POST', 'http://localhost/x', { title: 't', body: 'b', type: 'banner', display_mode: 'top_bar', showDuration: 30 }));
    expect(res.status).toBe(201);
  });

  test('PATCH rejects invalid fields and DELETE maps not_found', async () => {
    const res1 = await adsPATCH(adminReq('PATCH', 'http://localhost/x', { id: ID1, priority: 9999 }));
    expect(res1.status).toBe(400);
    mockDb.rpcResults.set('admin_manage_advertisement', { data: { not_found: true }, error: null });
    const res2 = await adsDELETE(adminReq('DELETE', 'http://localhost/x', { id: ID1 }));
    expect(res2.status).toBe(404);
  });
});

describe('admin/subscription-plans/[id] error branches', () => {
  test('PUT maps code conflict (409)', async () => {
    mockDb.rpcResults.set('admin_manage_subscription_plan', { data: null, error: { code: '23505' } });
    const res = await planPUT(adminReq('PUT', 'http://localhost/x', { name: 'باقة' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(409);
  });

  test('PUT maps not_found and historical-code errors', async () => {
    mockDb.rpcResults.set('admin_manage_subscription_plan', { data: { not_found: true }, error: null });
    const res1 = await planPUT(adminReq('PUT', 'http://localhost/x', { name: 'باقة' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('admin_manage_subscription_plan', { data: null, error: { message: 'code of a used plan' } });
    const res2 = await planPUT(adminReq('PUT', 'http://localhost/x', { name: 'باقة' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(409);
  });

  test('DELETE maps historical-subscription conflict', async () => {
    mockDb.rpcResults.set('delete_unused_subscription_plan_atomic', { data: null, error: { message: 'اشتراكات تاريخية' } });
    const res = await planDELETE(adminReq('DELETE', 'http://localhost/x', undefined, 'master-pass'), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(409);
  });
});
