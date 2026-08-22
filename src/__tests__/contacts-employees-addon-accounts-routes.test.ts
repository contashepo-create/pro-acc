/**
 * Route-boundary tests for contacts, employees, change-orders (list),
 * admin/addon-requests, petty-cash/boxes, accounts.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createToken, createAdminToken } from '@/lib/auth';

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

import { GET as contactGET, POST as contactPOST } from '@/app/api/contacts/route';
import { GET as empGET, POST as empPOST } from '@/app/api/employees/route';
import { GET as coGET, POST as coPOST } from '@/app/api/change-orders/route';
import { GET as addonGET, PUT as addonPUT } from '@/app/api/admin/addon-requests/route';
import { POST as boxPOST } from '@/app/api/petty-cash/boxes/route';
import { GET as accGET, POST as accPOST } from '@/app/api/accounts/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

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
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0 }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { contacts: true, employees: true, projects: true, petty_cash: true, accounts: true } } }],
    contacts: [], employees: [], change_orders: [], addon_requests: [], accounts: [], financial_audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('contacts', () => {
  test('GET lists contacts', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: ID1, company_id: C1, name: 'عميل', is_active: true, type: 'client' }] });
    const res = await contactGET(req('admin', 'GET', 'http://localhost/api/contacts'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.contacts).toHaveLength(1);
  });

  test('GET rejects an invalid type', async () => {
    const res = await contactGET(req('admin', 'GET', 'http://localhost/api/contacts?type=bogus'));
    expect(res.status).toBe(400);
  });

  test('POST creates a contact', async () => {
    mockDb.rpcResults.set('create_contact_atomic', { data: { id: ID1 }, error: null });
    const res = await contactPOST(req('admin', 'POST', 'http://localhost/x', { name: 'عميل', type: 'client' }));
    expect(res.status).toBe(201);
  });

  test('POST maps client plan-limit error', async () => {
    mockDb.rpcResults.set('create_contact_atomic', { data: null, error: { message: 'contact plan limit: clients' } });
    const res = await contactPOST(req('admin', 'POST', 'http://localhost/x', { name: 'عميل', type: 'client' }));
    expect(res.status).toBe(403);
  });
});

describe('employees', () => {
  test('GET lists employees', async () => {
    mockDb = makeDb({ ...baseDb(), employees: [{ id: ID1, company_id: C1, name: 'موظف' }] });
    const res = await empGET(req('admin', 'GET', 'http://localhost/api/employees'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.employees).toHaveLength(1);
  });

  test('GET rejects an invalid active filter', async () => {
    const res = await empGET(req('admin', 'GET', 'http://localhost/api/employees?active=bogus'));
    expect(res.status).toBe(400);
  });

  test('POST creates an employee', async () => {
    mockDb.rpcResults.set('create_employee_atomic', { data: { id: ID1 }, error: null });
    const res = await empPOST(req('admin', 'POST', 'http://localhost/x', { name: 'موظف', salary: 5000, hire_date: '2026-01-01' }));
    expect(res.status).toBe(201);
  });
});

describe('change-orders', () => {
  test('GET lists change orders', async () => {
    mockDb = makeDb({ ...baseDb(), change_orders: [{ id: ID1, company_id: C1, title: 'تغيير' }] });
    const res = await coGET(req('admin', 'GET', 'http://localhost/api/change-orders'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rows).toHaveLength(1);
  });

  test('POST creates a change order', async () => {
    mockDb.rpcResults.set('create_change_order_atomic', { data: { id: ID1 }, error: null });
    const res = await coPOST(req('admin', 'POST', 'http://localhost/x', { project_id: ID1, title: 'تغيير', change_amount: 100, status: 'draft' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects a non-draft/submitted status', async () => {
    const res = await coPOST(req('admin', 'POST', 'http://localhost/x', { project_id: ID1, title: 'تغيير', change_amount: 100, status: 'approved' }));
    expect(res.status).toBe(400);
  });
});

describe('admin/addon-requests', () => {
  test('GET lists addon requests', async () => {
    mockDb = makeDb({ ...baseDb(), addon_requests: [{ id: ID1, company_id: C1, status: 'pending' }] });
    const res = await addonGET(adminReq('GET', 'http://localhost/api/admin/addon-requests'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requests).toHaveLength(1);
  });

  test('GET rejects an invalid status', async () => {
    const res = await addonGET(adminReq('GET', 'http://localhost/api/admin/addon-requests?status=bogus'));
    expect(res.status).toBe(400);
  });

  test('PUT reviews an addon request', async () => {
    mockDb.rpcResults.set('review_addon_request', { data: { id: ID1 }, error: null });
    const res = await addonPUT(adminReq('PUT', 'http://localhost/x', { id: ID1, status: 'approved' }));
    expect(res.status).toBe(200);
  });
});

describe('petty-cash/boxes POST', () => {
  test('creates a petty cash box', async () => {
    mockDb.rpcResults.set('create_petty_cash_box', { data: { id: ID1 }, error: null });
    const res = await boxPOST(req('admin', 'POST', 'http://localhost/x', { name: 'صندوق' }));
    expect(res.status).toBe(201);
  });

  test('rejects an invalid name', async () => {
    const res = await boxPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res.status).toBe(400);
  });
});

describe('accounts', () => {
  test('GET returns the chart of accounts', async () => {
    mockDb = makeDb({ ...baseDb(), accounts: [
      { id: '1000', company_id: C1, code: '1000', name: 'أصول', type: 'asset', parent_id: null, is_header: true },
      { id: '1110', company_id: C1, code: '1110', name: 'نقد', type: 'asset', parent_id: '1000', is_header: false },
    ] });
    const res = await accGET(req('admin', 'GET', 'http://localhost/api/accounts'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.accounts.length).toBeGreaterThan(0);
  });

  test('POST creates an account', async () => {
    mockDb = makeDb({ ...baseDb(), accounts: [{ id: ID1, company_id: C1, code: '1000', name: 'أصول', type: 'asset', parent_id: null, is_header: true }] });
    const res = await accPOST(req('admin', 'POST', 'http://localhost/x', { code: '1001', name: 'نقد', type: 'asset', parentId: ID1 }));
    expect(res.status).toBe(201);
  });
});
