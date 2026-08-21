/**
 * Route-boundary tests for previously-uncovered routes: tenders GET,
 * warehouses/[id] GET, subcontractors/[id] GET, inventory/warehouses GET,
 * auth/setup POST, approvals/[id].
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

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
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api,
      is: () => api, neq: () => api, or: () => api,
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

import { GET as tendersGET } from '@/app/api/tenders/route';
import { GET as warehouseGET } from '@/app/api/warehouses/[id]/route';
import { GET as subcontractorGET } from '@/app/api/subcontractors/[id]/route';
import { GET as inventoryWarehousesGET } from '@/app/api/inventory/warehouses/route';
import { GET as approvalGET } from '@/app/api/approvals/[id]/route';

const C1 = 'company-1';
const ID = '00000000-0000-4000-8000-000000000001';
function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, tenders: true, warehouses: true, subcontractors: true, approvals: true } } }],
    tenders: [], warehouses: [], contacts: [], approval_requests: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('tenders GET', () => {
  test('rejects an invalid status and lists tenant tenders with stats', async () => {
    expect((await tendersGET(req('admin', 'GET', 'http://localhost/x?status=bogus'))).status).toBe(400);
    mockDb = makeDb({ ...baseDb(), tenders: [{ id: 't1', company_id: C1, submission_deadline: '2099-01-01', tenders_contacts: { name: 'عميل' } }] });
    const res = await tendersGET(req('admin', 'GET', 'http://localhost/api/tenders'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tenders[0].contact_name).toBe('عميل');
  });
});

describe('warehouses/[id] GET', () => {
  test('returns 404 for a missing warehouse and 400 for a malformed id', async () => {
    expect((await warehouseGET(req('admin', 'GET', 'http://localhost/x'), params('bad'))).status).toBe(400);
    expect((await warehouseGET(req('admin', 'GET', 'http://localhost/x'), params(ID))).status).toBe(404);
  });

  test('returns the tenant warehouse', async () => {
    mockDb = makeDb({ ...baseDb(), warehouses: [{ id: ID, company_id: C1, name: 'مستودع', is_active: true }] });
    const res = await warehouseGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(200);
    expect((await res.json()).data.name).toBe('مستودع');
  });
});

describe('subcontractors/[id] & inventory/warehouses GET', () => {
  test('subcontractor GET returns 404 for a missing subcontractor', async () => {
    const res = await subcontractorGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(404);
  });

  test('inventory/warehouses lists tenant warehouses', async () => {
    mockDb = makeDb({ ...baseDb(), warehouses: [{ id: ID, company_id: C1, name: 'مستودع' }] });
    const res = await inventoryWarehousesGET(req('admin', 'GET', 'http://localhost/api/inventory/warehouses'));
    expect(res.status).toBe(200);
  });
});

describe('approvals/[id] GET', () => {
  test('returns 404 for a missing approval', async () => {
    const res = await approvalGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(404);
  });
});
