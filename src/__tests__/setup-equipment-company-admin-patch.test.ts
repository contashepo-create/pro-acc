/**
 * Route-boundary tests for auth/setup, equipment/[id],
 * admin/companies/[id] PATCH (edit/cancel/plan actions), fixed-assets/depreciate.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createAdminToken, createToken, hashPassword } from '@/lib/auth';

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
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: (payload: Row | Row[]) => { db[table] = [...(db[table] || []), ...(Array.isArray(payload) ? payload : [payload])]; return api; },
      update: () => api, delete: () => api,
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

import { POST as setupPOST } from '@/app/api/auth/setup/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as eqGET, PUT as eqPUT, DELETE as eqDELETE } from '@/app/api/equipment/[id]/route';
import { PATCH as companyPATCH } from '@/app/api/admin/companies/[id]/route';
import { POST as depPOST } from '@/app/api/fixed-assets/depreciate/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const A1 = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const ID1 = '00000000-0000-4000-8000-0000000000b1';
let masterHash = '';

function userReq(method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', 'admin', 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function adminPatchReq(body?: Row, master?: string) {
  const token = createAdminToken(A1, 0);
  return { url: 'http://localhost/x', method: 'PATCH', nextUrl: new URL('http://localhost/x'),
    headers: { get: (k: string) => k === 'x-master-password' ? (master ?? null) : null },
    cookies: { get: (name: string) => name === 'admin_token' ? { value: token } : undefined },
    json: async () => body, text: async () => JSON.stringify(body) } as unknown as NextRequest;
}

function userBase() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0, master_password_hash: masterHash }],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    equipment: [], equipment_maintenance: [], equipment_usage: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(userBase()); });

describe('auth/setup POST', () => {
  test('creates the initial company and user', async () => {
    delete process.env.SETUP_TOKEN;
    mockDb.rpcResults.set('setup_initial_company', {
      data: { company: { id: C1, name: 'شركة' }, user: { id: 'u1', name: 'م', email: 'a@e.com', role: 'admin' } }, error: null,
    });
    const res = await setupPOST(userReq('POST', 'http://localhost/x', {
      company: { name: 'شركة' }, user: { name: 'م', email: 'a@example.com', password: 'StrongPass123!' },
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.setupProtected).toBe(false);
  });

  test('rejects missing fields and weak passwords', async () => {
    const res1 = await setupPOST(userReq('POST', 'http://localhost/x', {}));
    expect(res1.status).toBe(400);
    const res2 = await setupPOST(userReq('POST', 'http://localhost/x', {
      company: { name: 'شركة' }, user: { name: 'م', email: 'a@example.com', password: '12345678' },
    }));
    expect(res2.status).toBe(400);
  });

  test('rejects a wrong setup token', async () => {
    process.env.SETUP_TOKEN = 's'.repeat(32);
    const res = await setupPOST(userReq('POST', 'http://localhost/x', {
      company: { name: 'شركة' }, user: { name: 'م', email: 'a@example.com', password: 'StrongPass123!' }, setup_token: 'wrong',
    }));
    expect(res.status).toBe(403);
    delete process.env.SETUP_TOKEN;
  });

  test('maps already-configured error to 409', async () => {
    mockDb.rpcResults.set('setup_initial_company', { data: null, error: { message: 'تم إعداد النظام مسبقاً' } });
    const res = await setupPOST(userReq('POST', 'http://localhost/x', {
      company: { name: 'شركة' }, user: { name: 'م', email: 'a@example.com', password: 'StrongPass123!' },
    }));
    expect(res.status).toBe(409);
  });
});

describe('equipment/[id]', () => {
  test('GET returns equipment with histories', async () => {
    mockDb = makeDb({ ...userBase(), equipment: [{ id: ID1, company_id: C1, name: 'معدة' }], equipment_maintenance: [], equipment_usage: [] });
    const res = await eqGET(userReq('GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('GET returns 404 when missing', async () => {
    const res = await eqGET(userReq('GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(404);
  });

  test('GET rejects an invalid id', async () => {
    const res = await eqGET(userReq('GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('PUT updates equipment', async () => {
    mockDb = makeDb({ ...userBase(), equipment: [{ id: ID1, company_id: C1, name: 'معدة' }] });
    mockDb.rpcResults.set('update_equipment_atomic', { data: { id: ID1 }, error: null });
    const res = await eqPUT(userReq('PUT', 'http://localhost/x', { name: 'معدة ب' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });

  test('DELETE decommissions equipment', async () => {
    mockDb = makeDb({ ...userBase(), equipment: [{ id: ID1, company_id: C1, name: 'معدة' }] });
    mockDb.rpcResults.set('decommission_equipment_atomic', { data: { id: ID1 }, error: null });
    const res = await eqDELETE(userReq('DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
  });
});

describe('admin/companies/[id] PATCH', () => {
  beforeEach(async () => { masterHash = await hashPassword('master-pass'); mockDb = makeDb(userBase()); });

  test('edits a company with master password', async () => {
    mockDb.rpcResults.set('admin_update_company_profile', { data: { id: C1 }, error: null });
    const res = await companyPATCH(adminPatchReq({ action: 'edit_company', name: 'شركة محدثة' }, 'master-pass'), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(200);
  });

  test('rejects a plan change and subscription extension (409)', async () => {
    const res1 = await companyPATCH(adminPatchReq({ action: 'change_plan' }), { params: Promise.resolve({ id: C1 }) });
    expect(res1.status).toBe(409);
    const res2 = await companyPATCH(adminPatchReq({ action: 'extend_subscription' }), { params: Promise.resolve({ id: C1 }) });
    expect(res2.status).toBe(409);
  });

  test('cancels a subscription with master password', async () => {
    mockDb = makeDb({ ...userBase(), subscriptions: [{ id: 's1', company_id: C1, status: 'active' }] });
    mockDb.rpcResults.set('restrict_subscription_atomic', { data: null, error: null });
    const res = await companyPATCH(adminPatchReq({ action: 'cancel_subscription' }, 'master-pass'), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(200);
  });

  test('rejects an unknown action', async () => {
    const res = await companyPATCH(adminPatchReq({ action: 'bogus' }), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(400);
  });
});

describe('fixed-assets/depreciate POST', () => {
  test('returns 500 when the RPC fails', async () => {
    mockDb.rpcResults.set('depreciate_fixed_assets_batch', { data: null, error: { message: 'db down' } });
    const res = await depPOST(userReq('POST', 'http://localhost/api/fixed-assets/depreciate'));
    expect(res.status).toBe(500);
  });
});
