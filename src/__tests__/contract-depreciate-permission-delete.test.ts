/**
 * Route-boundary tests for contracts/[id] PUT error branches,
 * fixed-assets/depreciate success, permissions DELETE.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown } | null>();
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
      insert: () => api, update: () => api, delete: () => api,
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

import { PUT as conPUT } from '@/app/api/contracts/[id]/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { POST as depPOST } from '@/app/api/fixed-assets/depreciate/route';
import { DELETE as permDELETE } from '@/app/api/permissions/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000f0f1';

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
      subscription_plans: { code: 'enterprise', features_modules: { contracts: true, fixed_assets: true, settings: true } } }],
    contracts: [], user_permissions: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('contracts/[id] PUT branches', () => {
  test('rejects an invalid payload', async () => {
    const res = await conPUT(req('admin', 'PUT', 'http://localhost/x', { title: '' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(400);
  });

  test('maps not-found and transition errors', async () => {
    mockDb.rpcResults.set('update_contract_atomic', { data: null, error: { message: 'غير موجود' } });
    const res1 = await conPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'عقد' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('update_contract_atomic', { data: null, error: { message: 'انتقال حالة' } });
    const res2 = await conPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'عقد' }), { params: Promise.resolve({ id: ID1 }) });
    expect(res2.status).toBe(409);
  });
});

describe('fixed-assets/depreciate POST success', () => {
  test('posts a depreciation batch with a message', async () => {
    mockDb.rpcResults.set('depreciate_fixed_assets_batch', { data: { count: 2, totalDepreciation: 150.5 }, error: null });
    const res = await depPOST(req('admin', 'POST', 'http://localhost/api/fixed-assets/depreciate'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.message).toContain('2');
  });
});

describe('permissions DELETE', () => {
  test('rejects a missing userId', async () => {
    const res = await permDELETE(req('admin', 'DELETE', 'http://localhost/api/permissions'));
    expect(res.status).toBe(400);
  });

  test('deletes user permissions', async () => {
    const res = await permDELETE(req('admin', 'DELETE', `http://localhost/api/permissions?userId=${ID1}`));
    expect(res.status).toBe(200);
  });
});
