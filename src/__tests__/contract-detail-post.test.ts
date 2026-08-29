/**
 * Route-boundary tests for contracts/[id].
 * POST document upload was REMOVED with the contract-document storage
 * cancellation (migration 116) — the suite asserts the route module no longer
 * exposes POST at all, plus the GET/PUT error branches.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const storageCalls: Array<{ op: string; args: unknown[] }> = [];
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
  const storage: {
    uploadResult: { error: unknown } | null;
    from: (bucket: string) => {
      upload: (...args: unknown[]) => Promise<{ error: unknown }>;
      remove: (...args: unknown[]) => Promise<{ error: unknown }>;
    };
  } = {
    uploadResult: { error: null },
    from: (_bucket: string) => ({
      upload: async (...args: unknown[]) => { storageCalls.push({ op: 'upload', args }); return storage.uploadResult || { error: null }; },
      remove: async (...args: unknown[]) => { storageCalls.push({ op: 'remove', args }); return { error: null }; },
    }),
  };
  return {
    from, calls, rpcResults, db, storage,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

jest.mock('@/lib/plan-limits', () => ({
  getCompanyPlanLimits: async () => ({ max_storage_mb: 10 }),
  countUsedStorageBytes: async () => 0,
}));

import { GET as conGET, PUT as conPUT } from '@/app/api/contracts/[id]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

const C1 = 'company-1';
const CTID = '00000000-0000-4000-8000-00000000e0b1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { contracts: true } } }],
    contracts: [],
  } as Record<string, Row[]>;
}

beforeEach(() => {
  resetRateLimits();
  mockDb = makeDb(baseDb());
});

describe('contracts/[id] GET/PUT', () => {
  test('GET returns a contract with project and contact names, no documents', async () => {
    mockDb.db.contracts.push({ id: CTID, company_id: C1, name: 'عقد', projects: { name: 'مشروع أ' }, contacts: { name: 'عميل ب' } });
    const res = await conGET(req('admin', 'GET', 'http://localhost/api/contracts/' + CTID), { params: Promise.resolve({ id: CTID }) });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.project_name).toBe('مشروع أ');
    expect(body.data.contact_name).toBe('عميل ب');
    expect(body.data).not.toHaveProperty('documents');
  });

  test('GET returns 404 for a missing contract', async () => {
    const res = await conGET(req('admin', 'GET', 'http://localhost/api/contracts/' + CTID), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(404);
  });

  test('PUT maps a not-found update error to 404', async () => {
    mockDb.rpcResults.set('update_contract_atomic', { data: null, error: { message: 'العقد غير موجود' } });
    const res = await conPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'عقد جديد' }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(404);
  });

  test('PUT maps a state-transition error to 409', async () => {
    mockDb.rpcResults.set('update_contract_atomic', { data: null, error: { message: 'لا يمكن الانتقال إلى حالة' } });
    const res = await conPUT(req('admin', 'PUT', 'http://localhost/x', { title: 'عقد جديد' }), { params: Promise.resolve({ id: CTID }) });
    expect(res.status).toBe(409);
  });
});

describe('contracts/[id] POST document upload', () => {
  test('the upload route is gone (contract-document storage cancelled)', () => {
    const route = require('@/app/api/contracts/[id]/route') as Record<string, unknown>;
    expect(route.POST).toBeUndefined();
    expect(route.GET).toBeDefined();
    expect(route.PUT).toBeDefined();
    expect(route.DELETE).toBeDefined();
  });
});
