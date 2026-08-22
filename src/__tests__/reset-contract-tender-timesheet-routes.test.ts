/**
 * Route-boundary tests for the last uncovered core routes: company/reset,
 * contracts/[id] GET, tenders/[id] GET, timesheets/[id] GET.
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
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api, or: () => api,
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

import { POST as resetPOST } from '@/app/api/company/reset/route';
import { GET as contractGET } from '@/app/api/contracts/[id]/route';
import { GET as tenderGET } from '@/app/api/tenders/[id]/route';
import { PUT as timesheetPUT } from '@/app/api/timesheets/[id]/route';

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
      subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true, tenders: true, contracts: true, timesheets: true } } }],
    tenders: [], contracts: [], timesheets: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('company/reset', () => {
  test('rejects an invalid reset action payload (400)', async () => {
    const res = await resetPOST(req('admin', 'POST', 'http://localhost/x', { action: 'bogus' }));
    expect(res.status).toBe(400);
  });

  test('returns 409 when a reset session already exists', async () => {
    mockDb.rpcResults.set('start_telegram_reset_session_atomic', { data: null, error: { message: 'طلب تصفير قائم' } });
    const res = await resetPOST(req('admin', 'POST', 'http://localhost/x', { action: 'request' }));
    expect(res.status).toBe(409);
  });
});

describe('contracts/[id] GET', () => {
  test('returns 404 for a missing contract', async () => {
    const res = await contractGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(404);
  });

  test('returns the tenant contract with project/contact names', async () => {
    mockDb = makeDb({ ...baseDb(), contracts: [{ id: ID, company_id: C1, name: 'عقد', projects: { name: 'مشروع' }, contacts: { name: 'عميل' } }] });
    const res = await contractGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.project_name).toBe('مشروع');
  });
});

describe('tenders/[id] GET', () => {
  test('returns 404 for a missing tender', async () => {
    const res = await tenderGET(req('admin', 'GET', 'http://localhost/x'), params(ID));
    expect(res.status).toBe(404);
  });
});

describe('timesheets/[id] PUT (checkout)', () => {
  test('returns an error for a missing timesheet', async () => {
    const res = await timesheetPUT(req('admin', 'PUT', 'http://localhost/x', { action: 'checkout' }), params(ID));
    expect([404, 400]).toContain(res.status);
  });
});
