/**
 * Route-boundary tests for /api/admin/admins/[id]/telegram-token —
 * encrypted per-admin Telegram bot token management (migration 081).
 *
 * Invariants under test:
 *  - superadmin cookie session + master password gate (like other
 *    admin_users mutations);
 *  - the stored value is ALWAYS the enc:v1: envelope — plaintext never
 *    reaches the database and never appears in any response;
 *  - GET reports only { configured: boolean };
 *  - every mutation is audited;
 *  - a missing/invalid TELEGRAM_TOKEN_KEY yields a generic 500 (no
 *    internal detail in the response).
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
process.env.TELEGRAM_TOKEN_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
import { createAdminToken, hashPassword } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };
type Call = { table: string; ops: Op[]; payload: Row | Row[] | null };

function makeDb(db: Record<string, Row[]>) {
  const calls: Call[] = [];
  function from(table: string) {
    const ops: Op[] = [];
    const call: Call = { table, ops, payload: null };
    calls.push(call);
    function rows() {
      return (db[table] || []).filter((r) =>
        ops.every((o) => (o.op === 'eq' ? r[o.col!] === o.val : true))
      );
    }
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      update: (p: Row) => { call.payload = p; return api; },
      insert: (p: Row | Row[]) => {
        call.payload = p;
        db[table] = [...(db[table] || []), ...(Array.isArray(p) ? p : [p])];
        return api;
      },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: null }),
      then: <T1 = { data: unknown; error: unknown }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: null, error: null }).then(ok ?? undefined, fail ?? undefined),
    };
    return api;
  }
  return { from, calls };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET, PUT, DELETE } from '@/app/api/admin/admins/[id]/telegram-token/route';

const A1 = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_ID = '22222222-2222-4222-8222-222222222222';
const MASTER = 'master-pass-123';
const TOKEN = '1234567890:AAKd8sTz4xQ9mPwRvUy2cE3fG5hJ6lN0bXy';
const KAT_ENVELOPE =
  'enc:v1:ABEiM0RVZneImaq7:0ZtcELkpsME3Ckshc86Z7A==:FN2oOYfI8nRm9ei0+Q+w3ubNA9qsJjO9WNnGNJ1G/inZNvR996U0dMhEhKWRYA==';

let masterHash = '';
beforeAll(async () => {
  masterHash = await hashPassword(MASTER);
});

function baseDb(token: string | null = null) {
  mockDb = makeDb({
    admin_users: [{
      id: A1,
      email: 'admin@example.com',
      name: 'Admin',
      is_active: true,
      token_version: 0,
      password_hash: 'x',
      master_password_hash: masterHash,
      telegram_bot_token: token,
    }],
    admin_audit_log: [],
  });
}

function makeReq(opts: { admin?: boolean; master?: string | null; body?: Row } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.master != null) headers.set('x-master-password', opts.master);
  return {
    cookies: {
      get: (name: string) =>
        name === 'admin_token' && opts.admin !== false
          ? { value: createAdminToken(A1, 0) }
          : undefined,
    },
    headers,
    nextUrl: new URL('http://localhost/api/admins/x/telegram-token'),
    json: async () => opts.body ?? {},
  } as unknown as NextRequest;
}

const idOf = A1;
const params = () => Promise.resolve({ id: idOf });

describe('GET', () => {
  test('401 without an admin session', async () => {
    baseDb();
    const res = await GET(makeReq({ admin: false }), { params: params() });
    expect(res.status).toBe(401);
  });

  test('400 for a malformed id, 404 for an unknown one', async () => {
    baseDb();
    expect((await GET(makeReq(), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400);
    expect((await GET(makeReq(), { params: Promise.resolve({ id: UNKNOWN_ID }) })).status).toBe(404);
  });

  test('reports configured=false for NULL or legacy plaintext, true only for enc:v1:', async () => {
    baseDb(null);
    let res = await GET(makeReq(), { params: params() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { configured: false } });

    baseDb('some-legacy-plaintext');
    res = await GET(makeReq(), { params: params() });
    expect((await res.json()).data.configured).toBe(false);

    baseDb(KAT_ENVELOPE);
    res = await GET(makeReq(), { params: params() });
    expect((await res.json()).data.configured).toBe(true);
  });
});

describe('PUT', () => {
  test('401 without an admin session or without the master password', async () => {
    baseDb();
    expect((await PUT(makeReq({ admin: false, body: { token: TOKEN } }), { params: params() })).status).toBe(401);
    expect((await PUT(makeReq({ body: { token: TOKEN } }), { params: params() })).status).toBe(401);
  });

  test('401 with a wrong master password', async () => {
    baseDb();
    const res = await PUT(makeReq({ master: 'wrong', body: { token: TOKEN } }), { params: params() });
    expect(res.status).toBe(401);
  });

  test('400 for an empty or malformed token', async () => {
    baseDb();
    expect((await PUT(makeReq({ master: MASTER, body: { token: '' } }), { params: params() })).status).toBe(400);
    expect((await PUT(makeReq({ master: MASTER, body: {} }), { params: params() })).status).toBe(400);
    expect((await PUT(makeReq({ master: MASTER, body: { token: 'not-a-telegram-token' } }), { params: params() })).status).toBe(400);
    expect((await PUT(makeReq({ master: MASTER, body: { token: '1234567:AA' + 'x'.repeat(20) } }), { params: params() })).status).toBe(400);
  });

  test('stores the AES-256-GCM envelope (never plaintext) and never leaks the token', async () => {
    baseDb();
    const res = await PUT(makeReq({ master: MASTER, body: { token: TOKEN } }), { params: params() });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.configured).toBe(true);

    const updates = mockDb.calls.filter((c) => c.table === 'admin_users' && c.payload);
    expect(updates).toHaveLength(1);
    const stored = (updates[0].payload as Row).telegram_bot_token;
    expect(stored).toMatch(/^enc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toBe(TOKEN);

    // The plaintext token must not appear anywhere in the response.
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    const audits = mockDb.calls.filter((c) => c.table === 'admin_audit_log');
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({
      admin_id: A1,
      action: 'admin_telegram_token_set',
      target_type: 'admin',
      target_id: A1,
    });
  });

  test('500 (generic, no internals) when TELEGRAM_TOKEN_KEY is missing or invalid', async () => {
    const saved = process.env.TELEGRAM_TOKEN_KEY;
    baseDb();
    delete process.env.TELEGRAM_TOKEN_KEY;
    let res = await PUT(makeReq({ master: MASTER, body: { token: TOKEN } }), { params: params() });
    expect(res.status).toBe(500);
    let body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errorId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('TELEGRAM_TOKEN_KEY');

    process.env.TELEGRAM_TOKEN_KEY = 'invalid-hex';
    res = await PUT(makeReq({ master: MASTER, body: { token: TOKEN } }), { params: params() });
    expect(res.status).toBe(500);
    body = await res.json();
    expect(body.errorId).toBeTruthy();
    process.env.TELEGRAM_TOKEN_KEY = saved;
  });
});

describe('DELETE', () => {
  test('401 without the master password', async () => {
    baseDb();
    expect((await DELETE(makeReq(), { params: params() })).status).toBe(401);
  });

  test('clears the token (NULL) and audits the removal', async () => {
    baseDb(KAT_ENVELOPE);
    const res = await DELETE(makeReq({ master: MASTER }), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ configured: false });

    const updates = mockDb.calls.filter((c) => c.table === 'admin_users' && c.payload);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ telegram_bot_token: null });

    const audits = mockDb.calls.filter((c) => c.table === 'admin_audit_log');
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({
      admin_id: A1,
      action: 'admin_telegram_token_cleared',
      target_type: 'admin',
      target_id: A1,
    });
  });
});
