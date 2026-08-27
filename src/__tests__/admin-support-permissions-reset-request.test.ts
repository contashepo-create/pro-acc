/**
 * Route-boundary tests for admin/support GET, permissions GET,
 * company/reset request path.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createToken, createAdminToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
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
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: (_payload: Row | Row[]) => api, update: () => api, delete: () => api,
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

import { GET as supAdminGET } from '@/app/api/admin/support/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as permGET } from '@/app/api/permissions/route';
import { POST as resetPOST } from '@/app/api/company/reset/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}
function adminReq(method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createAdminToken(A1, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: () => null },
    cookies: { get: (name: string) => name === 'admin_token' ? { value: token } : undefined },
    json: async () => body, text: async () => JSON.stringify(body) } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0 }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    support_tickets: [], user_permissions: [], custom_modules: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('admin/support GET', () => {
  test('lists support tickets', async () => {
    mockDb = makeDb({ ...baseDb(), support_tickets: [{ id: ID1, subject: 'مشكلة', status: 'open' }] });
    const res = await supAdminGET(adminReq('GET', 'http://localhost/api/admin/support'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tickets).toHaveLength(1);
  });

  test('rejects an invalid status', async () => {
    const res = await supAdminGET(adminReq('GET', 'http://localhost/api/admin/support?status=bogus'));
    expect(res.status).toBe(400);
  });
});

describe('permissions GET', () => {
  test('lists company users with permissions for an admin', async () => {
    const res = await permGET(req('admin', 'GET', 'http://localhost/api/permissions'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data.users)).toBe(true);
  });

  test('returns 404 for an unknown target user', async () => {
    const res = await permGET(req('admin', 'GET', `http://localhost/api/permissions?userId=${ID1}`));
    expect(res.status).toBe(404);
  });
});

describe('company/reset request (ميزة ملغاة نهائياً)', () => {
  test('refuses to start a reset session with 410 and performs no DB work', async () => {
    const res = await resetPOST(req('admin', 'POST', 'http://localhost/x', { action: 'request' }));
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(mockDb.calls.length).toBe(0);
  });
});
