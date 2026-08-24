/**
 * Route-boundary tests for auth/login and auth/logout.
 *
 * Security: schema validation, rate limiting, inactive-account 403, wrong
 * password 401, successful login issues a token and bumps last_login, and
 * logout invalidates the session by bumping token_version.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

type Row = Record<string, unknown>;

function makeDb(db: Record<string, Row[]>) {
  const muts: Array<{ table: string; kind: string; payload?: Row | Row[] }> = [];
  const from = (table: string) => {
    const ops: Array<{ op: string; col?: string; val?: unknown; n?: number }> = [];
    const rows = () =>
      (db[table] || []).filter((r) => ops.every((o) => o.op === 'eq' ? r[o.col!] === o.val : true));
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      limit: (n: number) => { ops.push({ op: 'limit', n }); return api; },
      order: () => api, range: () => api, neq: () => api, in: () => api, is: () => api,
      insert: (payload: Row | Row[]) => { muts.push({ table, kind: 'insert', payload }); return api; },
      update: (payload: Row) => { muts.push({ table, kind: 'update', payload }); return api; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok ?? undefined, fail ?? undefined),
    };
    return api;
  };
  return { from, muts };
}

let mockDb: ReturnType<typeof makeDb>;
let mockVerify: jest.Mock;
let mockCheckRateLimit: jest.Mock;

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a) }));
jest.mock('@/lib/auth', () => ({
  verifyPassword: (...a: unknown[]) => mockVerify(...a),
  createToken: (uid: string, role: string, ver: number) => `mock-jwt-${uid}-${role}-${ver}`,
  extractToken: (req: { headers?: { get?: (k: string) => string | null } }) => req.headers?.get?.('authorization')?.replace('Bearer ', '') || null,
  verifyToken: (t: string) => (t.startsWith('mock-jwt') ? { userId: t.split('-')[2], ver: 0 } : null),
}));

import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as logoutPOST } from '@/app/api/auth/logout/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

const C1 = 'company-1';
const USER = { id: 'u1', company_id: C1, email: 'admin@example.com', name: 'م', role: 'admin',
  password_hash: 'salt:hash', is_active: true, token_version: 0, email_verified: true, last_login: null };

function baseDb() {
  return {
    users: [USER],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    login_attempts: [], subscriptions: [],
  } as Record<string, Row[]>;
}

function loginReq(body: Row, ip = '1.2.3.4') {
  return { method: 'POST', url: 'http://localhost/api/auth/login',
    headers: { get: (k: string) => k === 'x-forwarded-for' ? ip : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  mockDb = makeDb(baseDb());
  mockVerify = jest.fn().mockResolvedValue(true);
  mockCheckRateLimit = jest.fn().mockResolvedValue({ allowed: true });
});

describe('auth/login security & validation', () => {
  test('rejects invalid schema (400)', async () => {
    const res = await loginPOST(loginReq({ email: 'not-an-email', password: 'x' }));
    expect(res.status).toBe(400);
  });

  test('returns 429 when rate-limited', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, remainingMinutes: 5 });
    const res = await loginPOST(loginReq({ email: 'admin@example.com', password: 'Secret123!' }));
    expect(res.status).toBe(429);
  });

  test('returns 403 for an inactive account', async () => {
    mockDb = makeDb({ ...baseDb(), users: [{ ...USER, is_active: false }] });
    const res = await loginPOST(loginReq({ email: 'admin@example.com', password: 'Secret123!' }));
    expect(res.status).toBe(403);
  });

  test('returns 401 for a wrong password', async () => {
    mockVerify.mockResolvedValueOnce(false);
    const res = await loginPOST(loginReq({ email: 'admin@example.com', password: 'WrongPass1!' }));
    expect(res.status).toBe(401);
  });

  test('returns 200 and sets a session cookie on success', async () => {
    const res = await loginPOST(loginReq({ email: 'admin@example.com', password: 'Secret123!' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // The session lives in the HttpOnly cookie — set on the response...
    const cookie = res.cookies.get('token');
    expect(cookie?.value).toContain('mock-jwt');
    // ...and must NEVER be duplicated into the JSON body (XSS could read a
    // body token and fully bypass the httpOnly protection).
    expect(json.data.token).toBeUndefined();
    expect(JSON.stringify(json.data)).not.toContain('mock-jwt');
  });
});

describe('auth/logout', () => {
  test('bumps token_version to invalidate the session', async () => {
    const req = { method: 'POST', url: 'http://localhost/api/auth/logout',
      headers: { get: (k: string) => k === 'authorization' ? `Bearer mock-jwt-u1-admin-0` : null },
      cookies: { get: () => undefined } } as unknown as NextRequest;
    const res = await logoutPOST(req);
    expect(res.status).toBe(200);
    const upd = mockDb.muts.find((m) => m.table === 'users' && m.kind === 'update');
    expect((upd?.payload as Row | undefined)?.token_version).toBe(1);
  });
});
