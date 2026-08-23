/**
 * Deep coverage for subscription/activate-code GET branches,
 * permissions/modules PUT, dashboard project progress.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string): unknown => {
            let cur: unknown = r;
            for (const k of col.split('.')) {
              if (cur == null) break;
              cur = (cur as Record<string, unknown>)[k];
            }
            return cur;
          };
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(get(o.col!));
          if (o.op === 'ilike') return String(get(o.col!) ?? '').toLowerCase().includes(String(o.val).toLowerCase());
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      ilike: (col: string, val: unknown) => { ops.push({ op: 'ilike', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: () => api, update: (payload: Row) => { const r = (db[table] || [])[0]; if (r) Object.assign(r, payload); return api; },
      delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok ?? undefined, fail ?? undefined),
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

import { GET as actGET } from '@/app/api/subscription/activate-code/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { PUT as modPUT } from '@/app/api/permissions/modules/route';
import { GET as dashGET } from '@/app/api/dashboard/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';
const CODE = 'AB12-CD34-EF56-7890';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    activation_codes: [], subscription_plans: [], custom_modules: [], projects: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('activate-code GET deep', () => {
  test('reports a valid addon code', async () => {
    mockDb = makeDb({ ...baseDb(), activation_codes: [{ id: ID1, code: CODE, is_used: false, addon_type: 'extra_user', addon_quantity: 2 }] });
    const res = await actGET(req('admin', 'GET', `http://localhost/x?code=${CODE}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.type).toBe('addon');
    expect(json.data.quantity).toBe(2);
  });

  test('reports plan_unavailable when the plan is missing', async () => {
    mockDb = makeDb({ ...baseDb(), activation_codes: [{ id: ID1, code: CODE, is_used: false, plan_code: 'gone' }] });
    const res = await actGET(req('admin', 'GET', `http://localhost/x?code=${CODE}`));
    const json = await res.json();
    expect(json.data.valid).toBe(false);
    expect(json.data.reason).toBe('plan_unavailable');
  });

  test('reports wrong_company when targeted to another company', async () => {
    mockDb = makeDb({ ...baseDb(), activation_codes: [{ id: ID1, code: CODE, is_used: false, target_company_id: 'other' }] });
    const res = await actGET(req('admin', 'GET', `http://localhost/x?code=${CODE}`));
    const json = await res.json();
    expect(json.data.reason).toBe('wrong_company');
  });

  test('falls back to a legacy code lookup', async () => {
    mockDb = makeDb({ ...baseDb(), activation_codes: [{ id: ID1, code: CODE, is_used: false, plan_code: 'pro' }], subscription_plans: [{ code: 'pro', name: 'احترافي', is_active: true }] });
    const res = await actGET(req('admin', 'GET', `http://localhost/x?code=${CODE}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.valid).toBe(true);
  });
});

describe('permissions/modules PUT', () => {
  test('updates a custom module', async () => {
    mockDb = makeDb({ ...baseDb(), custom_modules: [{ id: ID1, company_id: C1, code: 'custom_1', name: 'قسم' }] });
    const res = await modPUT(req('admin', 'PUT', 'http://localhost/x', { id: ID1, name: 'قسم محدث' }));
    expect(res.status).toBe(200);
  });

  test('rejects a missing id', async () => {
    const res = await modPUT(req('admin', 'PUT', 'http://localhost/x', {}));
    expect(res.status).toBe(400);
  });
});

describe('dashboard deep', () => {
  test('computes project progress from start/end dates', async () => {
    const past = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const future = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    mockDb = makeDb({ ...baseDb(), projects: [{ id: ID1, company_id: C1, start_date: past, end_date: future, status: 'active' }] });
    mockDb.rpcResults.set('get_financial_summary', { data: { revenue: 0, expenses: 0, accountsReceivable: 0, accountsPayable: 0, cashBalance: 0 }, error: null });
    mockDb.rpcResults.set('get_assistant_company_snapshot', { data: { totalProjects: 1, activeProjects: 1, overdueInvoiceCount: 0, overdueInvoices: 0 }, error: null });
    const res = await dashGET(req('admin', 'GET', 'http://localhost/api/dashboard'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.totalProjects).toBe(1);
  });
});
