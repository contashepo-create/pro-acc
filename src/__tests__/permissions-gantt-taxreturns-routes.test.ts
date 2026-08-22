/**
 * Route-boundary tests for permissions (POST), gantt (PUT/DELETE),
 * tax-returns (POST).
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

import { POST as permPOST } from '@/app/api/permissions/route';
import { PUT as ganttPUT, DELETE as ganttDELETE } from '@/app/api/gantt/route';
import { POST as taxPOST } from '@/app/api/tax-returns/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: any) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as any;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { settings: true, projects: true, tax_reports: true } } }],
    users_all: [], custom_modules: [], user_permissions: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('permissions POST', () => {
  test('rejects a missing user_id', async () => {
    const res = await permPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res.status).toBe(400);
  });

  test('rejects an unknown user', async () => {
    const res = await permPOST(req('admin', 'POST', 'http://localhost/x', { user_id: ID1 }));
    expect(res.status).toBe(404);
  });

  test('saves a batch of permissions', async () => {
    mockDb = makeDb({ ...baseDb(), users: [...baseDb().users, { id: ID1, company_id: C1 }], custom_modules: [] });
    mockDb.rpcResults.set('replace_user_permissions', { data: null, error: null });
    const res = await permPOST(req('admin', 'POST', 'http://localhost/x', {
      user_id: ID1, batch: true, permissions: [{ module: 'journal', actions: ['read'] }],
    }));
    expect(res.status).toBe(200);
  });

  test('rejects an invalid module in batch', async () => {
    mockDb = makeDb({ ...baseDb(), users: [...baseDb().users, { id: ID1, company_id: C1 }], custom_modules: [] });
    const res = await permPOST(req('admin', 'POST', 'http://localhost/x', {
      user_id: ID1, batch: true, permissions: [{ module: 'bogus', actions: ['read'] }],
    }));
    expect(res.status).toBe(400);
  });
});

describe('gantt PUT/DELETE', () => {
  test('PUT updates a task and rejects invalid task_id', async () => {
    mockDb.rpcResults.set('update_project_task_atomic', { data: { id: ID1 }, error: null });
    const res = await ganttPUT(req('admin', 'PUT', `http://localhost/x?task_id=${ID1}`, { progress: 50 }));
    expect(res.status).toBe(200);
    const res2 = await ganttPUT(req('admin', 'PUT', 'http://localhost/x?task_id=bad', { progress: 50 }));
    expect(res2.status).toBe(400);
  });

  test('DELETE deletes an unstarted task and maps not-found', async () => {
    mockDb.rpcResults.set('delete_unstarted_project_task_atomic', { data: { id: ID1 }, error: null });
    const res = await ganttDELETE(req('admin', 'DELETE', `http://localhost/x?task_id=${ID1}`));
    expect(res.status).toBe(200);
    mockDb.rpcResults.set('delete_unstarted_project_task_atomic', { data: null, error: { message: 'غير موجودة' } });
    const res2 = await ganttDELETE(req('admin', 'DELETE', `http://localhost/x?task_id=${ID1}`));
    expect(res2.status).toBe(404);
  });
});

describe('tax-returns POST', () => {
  test('creates a filing', async () => {
    mockDb.rpcResults.set('create_vat_return_filing_atomic', { data: { id: ID1 }, error: null });
    const res = await taxPOST(req('admin', 'POST', 'http://localhost/x', { period_from: '2026-01-01', period_to: '2026-01-31' }));
    expect(res.status).toBe(201);
  });

  test('rejects an invalid period and a future period', async () => {
    const res1 = await taxPOST(req('admin', 'POST', 'http://localhost/x', { period_from: 'bad', period_to: 'x' }));
    expect(res1.status).toBe(400);
    const res2 = await taxPOST(req('admin', 'POST', 'http://localhost/x', { period_from: '2026-09-01', period_to: '2026-09-30' }));
    expect(res2.status).toBe(400);
  });
});
