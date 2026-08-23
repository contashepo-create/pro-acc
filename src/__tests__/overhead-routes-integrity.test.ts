/**
 * Route-boundary tests for the overhead-allocation API.
 *
 * Security: only admin/manager may create/update/delete rules; a non-admin
 * role is rejected; invalid UUIDs are rejected; tenant isolation is enforced.
 * Accounting/validation: name/basis/rate are validated server-side.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: Row | Row[] } }> = [];
  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: Row | Row[] } = {};
    calls.push({ table, ops, mut });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'neq') return r[o.col!] !== o.val;
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      order: () => api,
      range: () => api,
      limit: () => api,
      insert: (payload: Row | Row[]) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: Row) => { mut.kind = 'update'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok ?? undefined, fail ?? undefined),
    };
    return api;
  };
  return { from, calls };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET, POST } from '@/app/api/projects/overhead/route';
import { PUT, DELETE } from '@/app/api/projects/overhead/[id]/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

const C1 = 'company-1';
const RULE = '00000000-0000-4000-8000-000000000001';

const USER_IDS: Record<string, string> = {
  admin: 'u-admin', manager: 'u-manager', supervisor: 'u-supervisor', foreign: 'u-foreign',
};
let tokenCache: Record<string, string> = {};
function token(role: string): string {
  const userId = USER_IDS[role] || 'u-admin';
  if (!tokenCache[role]) tokenCache[role] = createToken(userId, role, 0);
  return tokenCache[role];
}
function authHeader(role: string): { get: (k: string) => string | null } {
  const h: Record<string, string> = { authorization: `Bearer ${token(role)}` };
  return { get: (key: string) => h[key] ?? null };
}
function requestAs(role: string, body?: Row, method = 'GET', url = 'http://localhost/api/projects/overhead') {
  return {
    method,
    url,
    headers: authHeader(role),
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [
      { id: 'u-admin', company_id: C1, is_active: true, token_version: 0, role: 'admin' },
      { id: 'u-manager', company_id: C1, is_active: true, token_version: 0, role: 'manager' },
      { id: 'u-supervisor', company_id: C1, is_active: true, token_version: 0, role: 'supervisor' },
      { id: 'u-foreign', company_id: 'company-2', is_active: true, token_version: 0, role: 'admin' },
    ],
    companies: [
      { id: C1, is_active: true },
      { id: 'company-2', is_active: true },
    ],
    subscriptions: [
      { id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
        subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true } } },
      { id: 's2', company_id: 'company-2', status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
        subscription_plans: { code: 'enterprise', features_modules: { projects: true, reports: true } } },
    ],
    overhead_allocations: [
      { id: RULE, company_id: C1, name: 'إدارة', allocation_basis: 'direct_cost', rate: 0.1, is_active: true },
    ],
  };
}

beforeEach(() => {
  mockDb = makeDb(baseDb());
  tokenCache = {};
});

describe('overhead routes — security & tenant isolation', () => {
  test('POST requires admin/manager (supervisor is rejected)', async () => {
    const res = await POST(requestAs('supervisor', { name: 'x', allocation_basis: 'direct_cost', rate: 0.1 }));
    expect(res.status).toBe(403);
    expect(mockDb.calls.some((c) => c.mut.kind === 'insert')).toBe(false);
  });

  test('GET is available to an authenticated non-admin', async () => {
    const res = await GET(requestAs('supervisor'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rows).toHaveLength(1);
  });

  test('a foreign-tenant admin cannot see this tenant rules', async () => {
    const res = await GET(requestAs('foreign'));
    const json = await res.json();
    expect(json.data.rows).toHaveLength(0);
  });

  test('POST rejects an invalid basis and an out-of-range rate before writing', async () => {
    const bad1 = await POST(requestAs('admin', { name: 'x', allocation_basis: 'hours', rate: 0.1 }));
    expect(bad1.status).toBe(400);
    const bad2 = await POST(requestAs('admin', { name: 'x', allocation_basis: 'direct_cost', rate: 1.5 }));
    expect(bad2.status).toBe(400);
    expect(mockDb.calls.some((c) => c.mut.kind === 'insert')).toBe(false);
  });

  test('POST requires name, basis and rate', async () => {
    const res = await POST(requestAs('admin', { name: 'x' }));
    expect(res.status).toBe(400);
    expect(mockDb.calls.some((c) => c.mut.kind === 'insert')).toBe(false);
  });

  test('POST rejects a duplicate name with 409', async () => {
    const res = await POST(requestAs('admin', { name: 'إدارة', allocation_basis: 'direct_cost', rate: 0.2 }));
    expect(res.status).toBe(409);
    expect(mockDb.calls.some((c) => c.mut.kind === 'insert')).toBe(false);
  });

  test('PUT/DELETE reject a non-UUID id before querying', async () => {
    const p = { params: Promise.resolve({ id: 'not-a-uuid' }) };
    const put = await PUT(requestAs('admin', { name: 'y' }, 'PUT'), p);
    expect(put.status).toBe(400);
    const del = await DELETE(requestAs('admin'), p);
    expect(del.status).toBe(400);
  });
});

describe('overhead routes — accounting validation', () => {
  test('POST stores a valid rule with defaults (is_active true)', async () => {
    const res = await POST(requestAs('admin', { name: 'مصاريف إدارية', allocation_basis: 'direct_labor', rate: 0.25 }));
    expect(res.status).toBe(201);
    const ins = mockDb.calls.find((c) => c.mut.kind === 'insert');
    expect(ins!.mut.payload).toMatchObject({
      company_id: C1, name: 'مصاريف إدارية', allocation_basis: 'direct_labor', rate: 0.25, is_active: true,
    });
  });

  test('PUT updates allowed fields and rejects empty updates', async () => {
    const p = { params: Promise.resolve({ id: RULE }) };
    const res = await PUT(requestAs('admin', { rate: 0.3 }, 'PUT'), p);
    expect(res.status).toBe(200);
    const upd = mockDb.calls.find((c) => c.mut.kind === 'update');
    expect(upd!.mut.payload).toEqual({ rate: 0.3 });

    const empty = await PUT(requestAs('admin', {}, 'PUT'), p);
    expect(empty.status).toBe(400);
  });

  test('DELETE removes a rule', async () => {
    const p = { params: Promise.resolve({ id: RULE }) } as any;
    const res = await DELETE(requestAs('admin'), p);
    expect(res.status).toBe(200);
    expect(mockDb.calls.some((c) => c.mut.kind === 'delete')).toBe(true);
  });
});
