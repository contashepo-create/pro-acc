/**
 * Route-boundary tests for quotations/[id] PUT/DELETE, approvals/[id] voucher
 * branch, company/reset confirm, admin/activation-codes branches.
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

import { PUT as quotePUT, DELETE as quoteDELETE } from '@/app/api/quotations/[id]/route';
import { PUT as apprPUT } from '@/app/api/approvals/[id]/route';
import { POST as resetPOST } from '@/app/api/company/reset/route';
import { GET as codesGET, POST as codesPOST } from '@/app/api/admin/activation-codes/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const ID1 = '00000000-0000-4000-8000-0000000000b1';

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
      subscription_plans: { code: 'enterprise', features_modules: { quotations: true, approvals: true, subscription: true } } }],
    quotations: [], approval_requests: [], activation_codes: [], companies_lookup: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('quotations/[id]', () => {
  test('PUT updates a quotation and rejects unknown fields', async () => {
    mockDb.rpcResults.set('update_draft_quotation', { data: { id: ID1 }, error: null });
    const res = await quotePUT(req('admin', 'PUT', 'http://localhost/x', { notes: 'ملاحظة' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const res2 = await quotePUT(req('admin', 'PUT', 'http://localhost/x', { evil: true }), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(400);
  });

  test('PUT rejects invalid items', async () => {
    const res = await quotePUT(req('admin', 'PUT', 'http://localhost/x', { items: [] }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(400);
  });

  test('DELETE deletes a draft quotation', async () => {
    mockDb.rpcResults.set('delete_draft_quotation', { data: true, error: null });
    const res = await quoteDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('approvals/[id] PUT voucher branch', () => {
  test('responds to a voucher disbursement approval', async () => {
    mockDb = makeDb({ ...baseDb(), approval_requests: [{ id: ID1, company_id: C1, entity_type: 'voucher_disbursement', status: 'pending' }] });
    mockDb.rpcResults.set('respond_voucher_disbursement_approval', { data: { id: ID1, status: 'approved' }, error: null });
    const res = await apprPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'approve' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('company/reset confirm', () => {
  test('maps an invalid-code RPC error to 400', async () => {
    mockDb.rpcResults.set('reset_company_business_data', { data: null, error: { message: 'رمز غير صالح' } });
    const res = await resetPOST(req('admin', 'POST', 'http://localhost/x', { action: 'confirm', code: '123456' }));
    expect(res.status).toBe(400);
  });
});

describe('admin/activation-codes', () => {
  test('GET lists used codes', async () => {
    mockDb = makeDb({ ...baseDb(), activation_codes: [{ id: ID1, code: 'AB12CD34-EF56-7890-ABCD-EF1234567890', is_used: true }] });
    const res = await codesGET(adminReq('GET', 'http://localhost/api/admin/activation-codes?used=true'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.codes).toHaveLength(1);
  });

  test('POST rejects an invalid addon quantity', async () => {
    const res = await codesPOST(adminReq('POST', 'http://localhost/x', { addonType: 'extra_user', addonQuantity: 0 }));
    expect(res.status).toBe(400);
  });
});
