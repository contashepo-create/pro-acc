/**
 * Route-boundary tests for company/users POST and timesheets POST.
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

import { POST as cuPOST } from '@/app/api/company/users/route';
import { POST as tsPOST } from '@/app/api/timesheets/route';
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
      subscription_plans: { code: 'enterprise', max_users: 10, features_modules: { employees: true } } }],
    employees: [], projects: [], timesheets: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('company/users POST', () => {
  const valid = { email: 'new@example.com', name: 'موظف', password: 'StrongPass123!', role: 'accountant' };

  test('creates a company user', async () => {
    const res = await cuPOST(req('admin', 'POST', 'http://localhost/x', valid));
    expect(res.status).toBe(201);
  });

  test('rejects missing fields, invalid email and invalid role', async () => {
    const res1 = await cuPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res1.status).toBe(400);
    const res2 = await cuPOST(req('admin', 'POST', 'http://localhost/x', { ...valid, email: 'bad' }));
    expect(res2.status).toBe(400);
    const res3 = await cuPOST(req('admin', 'POST', 'http://localhost/x', { ...valid, role: 'bogus' }));
    expect(res3.status).toBe(400);
  });

  test('enforces the single-admin constraint', async () => {
    mockDb = makeDb({ ...baseDb(), users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }] });
    const res = await cuPOST(req('admin', 'POST', 'http://localhost/x', { ...valid, role: 'admin' }));
    expect(res.status).toBe(403);
  });

  test('rejects a weak password', async () => {
    const res = await cuPOST(req('admin', 'POST', 'http://localhost/x', { ...valid, password: '123' }));
    expect(res.status).toBe(400);
  });
});

describe('timesheets POST', () => {
  test('rejects a missing employee_id or date', async () => {
    const res = await tsPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown employee', async () => {
    const res = await tsPOST(req('admin', 'POST', 'http://localhost/x', { employee_id: ID1, date: '2026-01-01' }));
    expect(res.status).toBe(404);
  });

  test('creates a timesheet entry', async () => {
    mockDb = makeDb({ ...baseDb(), employees: [{ id: ID1, company_id: C1, name: 'موظف' }] });
    const res = await tsPOST(req('admin', 'POST', 'http://localhost/x', {
      employee_id: ID1, date: '2026-01-01', check_in: '2026-01-01T08:00:00Z', check_out: '2026-01-01T16:00:00Z',
    }));
    expect(res.status).toBe(201);
  });
});
