/**
 * Route-boundary tests for admin/upgrade-requests, admin/messages,
 * admin/complaints, fiscal/validate-balances, gantt/dependencies,
 * reports/cash-flow (empty path).
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
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://s' }, error: null }) }) },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as upgGET, PUT as upgPUT } from '@/app/api/admin/upgrade-requests/route';
import { GET as msgGET, POST as msgPOST } from '@/app/api/admin/messages/route';
import { GET as compGET, PATCH as compPATCH } from '@/app/api/admin/complaints/route';
import { GET as validateGET } from '@/app/api/fiscal/validate-balances/route';
import { GET as depGET, POST as depPOST, DELETE as depDELETE } from '@/app/api/gantt/dependencies/route';
import { GET as cashflowGET } from '@/app/api/reports/cash-flow/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const A1 = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const ID1 = '00000000-0000-4000-8000-0000000000b1';

function adminReq(method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createAdminToken(A1, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: () => null },
    cookies: { get: (name: string) => name === 'admin_token' ? { value: token } : undefined },
    json: async () => body, text: async () => JSON.stringify(body) } as any;
}

function userReq(method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', 'admin', 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function adminBase() {
  return {
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0 }],
    upgrade_requests: [], messages: [], complaints: [], companies: [], subscription_plans: [], users: [],
  } as Record<string, Row[]>;
}

function userBase() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    accounts: [], journal_lines: [], projects: [], project_task_dependencies: [],
  } as Record<string, Row[]>;
}

function fullBase() {
  return { ...userBase(), admin_users: adminBase().admin_users, upgrade_requests: [], messages: [], complaints: [], subscription_plans: [], projects: [], project_task_dependencies: [] };
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(fullBase()); });

describe('admin/upgrade-requests', () => {
  test('GET lists pending requests', async () => {
    mockDb = makeDb({ ...adminBase(), upgrade_requests: [{ id: ID1, company_id: C1, user_id: 'u1', status: 'pending' }] });
    const res = await upgGET(adminReq('GET', 'http://localhost/api/admin/upgrade-requests'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requests).toHaveLength(1);
  });

  test('GET rejects an invalid status filter', async () => {
    const res = await upgGET(adminReq('GET', 'http://localhost/api/admin/upgrade-requests?status=bogus'));
    expect(res.status).toBe(400);
  });

  test('PUT reviews an upgrade request', async () => {
    mockDb.rpcResults.set('review_upgrade_request', { data: { id: ID1 }, error: null });
    const res = await upgPUT(adminReq('PUT', 'http://localhost/x', { id: ID1, status: 'approved' }));
    expect(res.status).toBe(200);
  });

  test('PUT rejects an invalid status', async () => {
    const res = await upgPUT(adminReq('PUT', 'http://localhost/x', { id: ID1, status: 'bogus' }));
    expect(res.status).toBe(400);
  });
});

describe('admin/messages', () => {
  test('GET lists messages with company names', async () => {
    mockDb = makeDb({ ...adminBase(), messages: [{ id: ID1, company_id: C1, subject: 'مرحباً' }], companies: [{ id: C1, name: 'شركة' }] });
    const res = await msgGET(adminReq('GET', 'http://localhost/api/admin/messages'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].company_name).toBe('شركة');
  });

  test('GET rejects an invalid company filter', async () => {
    const res = await msgGET(adminReq('GET', 'http://localhost/api/admin/messages?companyId=bad'));
    expect(res.status).toBe(400);
  });

  test('POST sends a company message', async () => {
    mockDb.rpcResults.set('admin_send_company_message', { data: { id: ID1 }, error: null });
    const res = await msgPOST(adminReq('POST', 'http://localhost/x', { companyId: C1, subject: 'مرحباً', body: 'نص' }));
    expect(res.status).toBe(201);
  });
});

describe('admin/complaints', () => {
  test('GET lists complaints', async () => {
    mockDb = makeDb({ ...adminBase(), complaints: [{ id: ID1, company_id: C1, subject: 'شكوى' }], companies: [{ id: C1, name: 'شركة' }] });
    const res = await compGET(adminReq('GET', 'http://localhost/api/admin/complaints'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].company_name).toBe('شركة');
  });

  test('GET rejects an invalid status', async () => {
    const res = await compGET(adminReq('GET', 'http://localhost/api/admin/complaints?status=bogus'));
    expect(res.status).toBe(400);
  });

  test('PATCH updates a complaint', async () => {
    mockDb.rpcResults.set('admin_update_complaint', { data: { id: ID1 }, error: null });
    const res = await compPATCH(adminReq('PATCH', 'http://localhost/x', { id: ID1, status: 'replied', adminReply: 'تم' }));
    expect(res.status).toBe(200);
  });
});

describe('fiscal/validate-balances GET', () => {
  test('returns an empty report when there are no accounts', async () => {
    mockDb = makeDb(userBase());
    const res = await validateGET(userReq('GET', 'http://localhost/api/fiscal/validate-balances'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.totalIssues).toBe(0);
  });
});

describe('gantt/dependencies', () => {
  test('GET lists dependencies', async () => {
    mockDb = makeDb({ ...userBase(), projects: [{ id: ID1, company_id: C1 }], project_task_dependencies: [{ id: ID1, project_id: ID1, company_id: C1 }] });
    const res = await depGET(userReq('GET', `http://localhost/x?project_id=${ID1}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  test('GET returns 404 for an unknown project', async () => {
    const res = await depGET(userReq('GET', `http://localhost/x?project_id=${ID1}`));
    expect(res.status).toBe(404);
  });

  test('POST creates a dependency', async () => {
    mockDb.rpcResults.set('create_task_dependency_atomic', { data: { id: ID1 }, error: null });
    const res = await depPOST(userReq('POST', 'http://localhost/x', { successor_task_id: ID1, predecessor_task_id: C1, lag_days: 1 }));
    expect(res.status).toBe(201);
  });

  test('DELETE removes a dependency', async () => {
    mockDb.rpcResults.set('delete_task_dependency_atomic', { data: { deleted: true }, error: null });
    const res = await depDELETE(userReq('DELETE', `http://localhost/x?dependency_id=${ID1}`));
    expect(res.status).toBe(200);
  });

  test('POST maps a cycle error to 409', async () => {
    mockDb.rpcResults.set('create_task_dependency_atomic', { data: null, error: { message: 'دورة' } });
    const res = await depPOST(userReq('POST', 'http://localhost/x', { successor_task_id: ID1, predecessor_task_id: C1, lag_days: 1 }));
    expect(res.status).toBe(409);
  });
});

describe('reports/cash-flow GET', () => {
  test('returns an empty report when there are no cash accounts', async () => {
    mockDb = makeDb({ ...userBase(), accounts: [{ id: ID1, company_id: C1, code: '1000', name: 'نقد', type: 'asset' }] });
    const res = await cashflowGET(userReq('GET', 'http://localhost/api/reports/cash-flow'));
    expect(res.status).toBe(200);
  });

  test('rejects an invalid date range', async () => {
    const res = await cashflowGET(userReq('GET', 'http://localhost/api/reports/cash-flow?from=bad'));
    expect(res.status).toBe(400);
  });
});
