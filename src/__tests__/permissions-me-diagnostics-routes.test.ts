/**
 * Route-boundary tests for /api/permissions/actions, /api/permissions/modules,
 * /api/auth/me, and /api/diagnostics.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken, hashPassword } from '@/lib/auth';

const sendVerificationEmailMock = jest.fn();
jest.mock('@/lib/email', () => ({ sendVerificationEmail: (...a: unknown[]) => sendVerificationEmailMock(...a) }));

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
      insert: (payload: Row | Row[]) => { db[table] = [...(db[table] || []), ...(Array.isArray(payload) ? payload : [payload])]; return api; },
      update: (payload: Row) => { const r = (db[table] || [])[0]; if (r) Object.assign(r, payload); return api; },
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

import { GET as actionsGET, POST as actionsPOST, DELETE as actionsDELETE, PUT as actionsPUT } from '@/app/api/permissions/actions/route';
import { GET as modulesGET, POST as modulesPOST, DELETE as modulesDELETE } from '@/app/api/permissions/modules/route';
import { GET as meGET, PUT as mePUT } from '@/app/api/auth/me/route';
import { GET as diagnosticsGET } from '@/app/api/diagnostics/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

const C1 = 'company-1';
const UID = '00000000-0000-4000-8000-00000000d0d1';
const ACT = '00000000-0000-4000-8000-00000000d0e1';
let passHash = '';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'مستخدم', email: 'u@example.com', is_active: true, token_version: 0, role: 'admin', password_hash: passHash }],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    custom_actions: [], custom_modules: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeAll(async () => { passHash = await hashPassword('old-pass-123'); });
beforeEach(() => { resetRateLimits(); sendVerificationEmailMock.mockReset(); mockDb = makeDb(baseDb()); });

describe('permissions/actions', () => {
  test('GET lists custom actions', async () => {
    mockDb = makeDb({ ...baseDb(), custom_actions: [{ id: ACT, company_id: C1, name: 'act', code: 'view', is_system: true }] });
    const res = await actionsGET(req('admin', 'GET', 'http://localhost/api/permissions/actions'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.actions).toHaveLength(1);
  });

  test('POST creates an action', async () => {
    const res = await actionsPOST(req('admin', 'POST', 'http://localhost/x', { name: 'عرض', code: 'View Data' }));
    expect(res.status).toBe(201);
    expect(mockDb.calls.some((c) => c.table === 'custom_actions')).toBe(true);
  });

  test('POST rejects missing name/code', async () => {
    const res1 = await actionsPOST(req('admin', 'POST', 'http://localhost/x', { code: 'x' }));
    expect(res1.status).toBe(400);
    const res2 = await actionsPOST(req('admin', 'POST', 'http://localhost/x', { name: 'x' }));
    expect(res2.status).toBe(400);
  });

  test('POST rejects a duplicate code', async () => {
    mockDb = makeDb({ ...baseDb(), custom_actions: [{ id: ACT, company_id: C1, code: 'view' }] });
    const res = await actionsPOST(req('admin', 'POST', 'http://localhost/x', { name: 'x', code: 'view' }));
    expect(res.status).toBe(400);
  });

  test('DELETE removes a custom action', async () => {
    mockDb = makeDb({ ...baseDb(), custom_actions: [{ id: ACT, company_id: C1, code: 'view', name: 'x', is_system: false }] });
    const res = await actionsDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ACT}`));
    expect(res.status).toBe(200);
  });

  test('DELETE rejects a system action', async () => {
    mockDb = makeDb({ ...baseDb(), custom_actions: [{ id: ACT, company_id: C1, code: 'view', name: 'x', is_system: true }] });
    const res = await actionsDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ACT}`));
    expect(res.status).toBe(400);
  });

  test('PUT updates an action', async () => {
    mockDb = makeDb({ ...baseDb(), custom_actions: [{ id: ACT, company_id: C1, code: 'view', name: 'x' }] });
    const res = await actionsPUT(req('admin', 'PUT', 'http://localhost/x', { id: ACT, name: 'new' }));
    expect(res.status).toBe(200);
  });
});

describe('permissions/modules', () => {
  test('GET lists custom modules', async () => {
    const res = await modulesGET(req('admin', 'GET', 'http://localhost/api/permissions/modules'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.modules).toEqual([]);
  });

  test('POST creates a module', async () => {
    const res = await modulesPOST(req('admin', 'POST', 'http://localhost/x', { name: 'قسم' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects a missing name', async () => {
    const res = await modulesPOST(req('admin', 'POST', 'http://localhost/x', {}));
    expect(res.status).toBe(400);
  });

  test('DELETE removes a module via RPC', async () => {
    mockDb.rpcResults.set('delete_custom_module_atomic', { data: true, error: null });
    const res = await modulesDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ACT}`));
    expect(res.status).toBe(200);
  });

  test('DELETE maps not-found and system errors', async () => {
    mockDb.rpcResults.set('delete_custom_module_atomic', { data: null, error: { message: 'غير موجود' } });
    const res1 = await modulesDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ACT}`));
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('delete_custom_module_atomic', { data: null, error: { message: 'نظامي' } });
    const res2 = await modulesDELETE(req('admin', 'DELETE', `http://localhost/x?id=${ACT}`));
    expect(res2.status).toBe(409);
  });
});

describe('auth/me', () => {
  test('GET returns the profile and company', async () => {
    const res = await meGET(req('admin', 'GET', 'http://localhost/api/auth/me'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.user.email).toBe('u@example.com');
    expect(json.data.company.name).toBe('شركة');
  });

  test('PUT updates the name', async () => {
    const res = await mePUT(req('admin', 'PUT', 'http://localhost/api/auth/me', { name: 'اسم جديد' }));
    expect(res.status).toBe(200);
  });

  test('PUT changes the password', async () => {
    const res = await mePUT(req('admin', 'PUT', 'http://localhost/api/auth/me', { old_password: 'old-pass-123', new_password: 'new-pass-123' }));
    expect(res.status).toBe(200);
  });

  test('PUT rejects a wrong old password', async () => {
    const res = await mePUT(req('admin', 'PUT', 'http://localhost/api/auth/me', { old_password: 'wrong', new_password: 'new-pass-123' }));
    expect(res.status).toBe(400);
  });

  test('PUT changes the email and flags verification pending', async () => {
    sendVerificationEmailMock.mockResolvedValue(true);
    const res = await mePUT(req('admin', 'PUT', 'http://localhost/api/auth/me', { email: 'new@example.com' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('PUT rejects a duplicate email', async () => {
    mockDb = makeDb({ ...baseDb(), users: [
      { id: 'u1', company_id: C1, name: 'a', email: 'u@example.com', is_active: true, token_version: 0, role: 'admin', password_hash: passHash },
      { id: UID, company_id: C1, name: 'b', email: 'new@example.com', is_active: true, token_version: 0, role: 'admin', password_hash: passHash },
    ] });
    const res = await mePUT(req('admin', 'PUT', 'http://localhost/api/auth/me', { email: 'new@example.com' }));
    expect(res.status).toBe(409);
  });
});

describe('diagnostics GET', () => {
  test('returns a report when authorized by secret', async () => {
    process.env.DIAGNOSTICS_SECRET = 'diag-secret-123';
    const res = await diagnosticsGET({ url: 'http://localhost/api/diagnostics', headers: { get: (k: string) => k === 'x-diagnostics-secret' ? 'diag-secret-123' : null } } as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ok).toBeDefined();
    delete process.env.DIAGNOSTICS_SECRET;
  });

  test('rejects an unauthorized caller', async () => {
    delete process.env.DIAGNOSTICS_SECRET;
    delete process.env.CRON_SECRET;
    const res = await diagnosticsGET({ url: 'http://localhost/api/diagnostics', headers: { get: () => null } } as any);
    expect(res.status).toBe(401);
  });
});
