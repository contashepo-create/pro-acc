/**
 * Route-boundary tests for the superadmin authentication flow:
 * /api/admin/{login,send-telegram-code,verify-telegram,verify-master,logout}.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createAdminToken, hashPassword } from '@/lib/auth';

const sendTelegramCodeMock = jest.fn();
jest.mock('@/lib/telegram', () => ({
  sendTelegramCode: (...a: any[]) => sendTelegramCodeMock(...a),
  sendAdminNotification: jest.fn(async () => true),
  escapeTelegramHtml: (s: string) => s,
}));

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
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
          if (o.op === 'gte') return String(r[o.col!]) >= String(o.val);
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      or: () => api, order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      lt: () => api, gte: (col: string, val: any) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: () => api, contains: () => api,
      insert: (payload: any) => { db[table] = [...(db[table] || []), payload]; return api; },
      update: (payload: any) => { const r = (db[table] || [])[0]; if (r) Object.assign(r, payload); return api; },
      delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found', code: 'PGRST116' } }),
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

import { POST as loginPOST } from '@/app/api/admin/login/route';
import { POST as verifyTelegramPOST } from '@/app/api/admin/verify-telegram/route';
import { POST as verifyMasterPOST } from '@/app/api/admin/verify-master/route';
import { POST as sendCodePOST } from '@/app/api/admin/send-telegram-code/route';
import { POST as logoutPOST } from '@/app/api/admin/logout/route';

const A1 = '00000000-0000-4000-8000-0000000000a1';
const SESSION = 'a'.repeat(64);
const EMAIL = 'admin@example.com';

let passHash = '';
let masterHash = '';

function baseDb() {
  return {
    admin_users: [{
      id: A1, email: EMAIL, name: 'مدير', is_active: true, token_version: 0,
      password_hash: passHash, master_password_hash: masterHash, login_session_data: null,
    }],
    login_attempts: [], admin_audit_log: [],
  } as Record<string, Row[]>;
}

beforeAll(async () => {
  passHash = await hashPassword('admin-pass');
  masterHash = await hashPassword('master-pass');
});
beforeEach(() => { sendTelegramCodeMock.mockReset(); mockDb = makeDb(baseDb()); });

function req(method = 'POST', url = 'http://localhost/x', body?: any, session?: string, adminToken?: string, extraHeaders: Record<string, string> = {}) {
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => extraHeaders[k] ?? null },
    cookies: { get: (name: string) => name === 'admin_session' && session ? { value: session } : (name === 'admin_token' && adminToken ? { value: adminToken } : undefined) },
    json: async () => body, text: async () => JSON.stringify(body) } as any;
}

describe('admin/login POST', () => {
  test('returns 400 for an invalid payload', async () => {
    const res = await loginPOST(req('POST', 'http://localhost/x', { email: 'x', password: '' }));
    expect(res.status).toBe(400);
  });

  test('returns 401 for an unknown email', async () => {
    mockDb = makeDb({ ...baseDb(), admin_users: [] });
    const res = await loginPOST(req('POST', 'http://localhost/x', { email: EMAIL, password: 'admin-pass' }));
    expect(res.status).toBe(401);
  });

  test('returns 403 for an inactive account', async () => {
    mockDb = makeDb({ ...baseDb(), admin_users: [{ id: A1, email: EMAIL, is_active: false, password_hash: passHash, token_version: 0 }] });
    const res = await loginPOST(req('POST', 'http://localhost/x', { email: EMAIL, password: 'admin-pass' }));
    expect(res.status).toBe(403);
  });

  test('returns 401 for a wrong password', async () => {
    const res = await loginPOST(req('POST', 'http://localhost/x', { email: EMAIL, password: 'wrong' }));
    expect(res.status).toBe(401);
  });

  test('succeeds and sends a 2FA code', async () => {
    sendTelegramCodeMock.mockResolvedValue(true);
    const res = await loginPOST(req('POST', 'http://localhost/x', { email: EMAIL, password: 'admin-pass' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.message).toContain('رمز التحقق');
    expect(sendTelegramCodeMock).toHaveBeenCalled();
  });

  test('returns 503 when telegram is not configured', async () => {
    sendTelegramCodeMock.mockResolvedValue(false);
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await loginPOST(req('POST', 'http://localhost/x', { email: EMAIL, password: 'admin-pass' }));
    expect(res.status).toBe(503);
  });
});

describe('admin/logout POST', () => {
  test('clears cookies even without a token', async () => {
    const res = await logoutPOST(req('POST', 'http://localhost/x'));
    expect(res.status).toBe(200);
  });

  test('revokes the admin session when a token is present', async () => {
    const token = createAdminToken(A1, 0);
    const res = await logoutPOST(req('POST', 'http://localhost/x', undefined, undefined, token));
    expect(res.status).toBe(200);
  });
});

describe('admin/verify-telegram POST', () => {
  test('rejects an invalid code format', async () => {
    const res = await verifyTelegramPOST(req('POST', 'http://localhost/x', { email: EMAIL, code: 'abc' }));
    expect(res.status).toBe(400);
  });

  test('rejects a missing session', async () => {
    const res = await verifyTelegramPOST(req('POST', 'http://localhost/x', { email: EMAIL, code: '123456' }));
    expect(res.status).toBe(401);
  });

  test('verifies a valid 6-digit code via RPC', async () => {
    mockDb.rpcResults.set('verify_admin_login_otp', { data: { status: 'verified' }, error: null });
    const res = await verifyTelegramPOST(req('POST', 'http://localhost/x', { email: EMAIL, code: '123456' }, `${A1}.${SESSION}`));
    expect(res.status).toBe(200);
  });

  test('maps locked and invalid-code statuses', async () => {
    mockDb.rpcResults.set('verify_admin_login_otp', { data: { status: 'locked' }, error: null });
    const res1 = await verifyTelegramPOST(req('POST', 'http://localhost/x', { email: EMAIL, code: '123456' }, `${A1}.${SESSION}`));
    expect(res1.status).toBe(429);
    mockDb.rpcResults.set('verify_admin_login_otp', { data: { status: 'invalid_code' }, error: null });
    const res2 = await verifyTelegramPOST(req('POST', 'http://localhost/x', { email: EMAIL, code: '123456' }, `${A1}.${SESSION}`));
    expect(res2.status).toBe(401);
  });
});

describe('admin/verify-master POST', () => {
  const sessionObj = {
    sessionId: SESSION, email: EMAIL, codeHash: 'a'.repeat(64), step: 'telegram_verified',
    codeSent: true, otpExpiresAt: Date.now() + 60000, attempts: 0, lastResendAt: Date.now(), expiresAt: Date.now() + 60000,
  };

  test('rejects a missing session', async () => {
    const res = await verifyMasterPOST(req('POST', 'http://localhost/x', { email: EMAIL, masterPassword: 'master-pass' }));
    expect(res.status).toBe(401);
  });

  test('rejects a missing master password', async () => {
    const res = await verifyMasterPOST(req('POST', 'http://localhost/x', { email: EMAIL }, `${A1}.${SESSION}`));
    expect(res.status).toBe(400);
  });

  test('succeeds and issues an admin token', async () => {
    mockDb = makeDb({ ...baseDb() });
    mockDb.from('admin_users'); // warm
    // Provide the session in login_session_data for getSession.
    mockDb = makeDb({ ...baseDb(), admin_users: [{
      id: A1, email: EMAIL, name: 'مدير', is_active: true, token_version: 0,
      password_hash: passHash, master_password_hash: masterHash, login_session_data: sessionObj,
    }] });
    const res = await verifyMasterPOST(req('POST', 'http://localhost/x', { email: EMAIL, masterPassword: 'master-pass' }, `${A1}.${SESSION}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.admin.role).toBe('superadmin');
  });

  test('rejects an email mismatch', async () => {
    mockDb = makeDb({ ...baseDb(), admin_users: [{ id: A1, email: EMAIL, is_active: true, token_version: 0, password_hash: passHash, master_password_hash: masterHash, login_session_data: sessionObj }] });
    const res = await verifyMasterPOST(req('POST', 'http://localhost/x', { email: 'other@example.com', masterPassword: 'master-pass' }, `${A1}.${SESSION}`));
    expect(res.status).toBe(401);
  });
});

describe('admin/send-telegram-code POST', () => {
  test('rejects a missing email', async () => {
    const res = await sendCodePOST(req('POST', 'http://localhost/x', {}));
    expect(res.status).toBe(400);
  });

  test('rejects an invalid session pointer', async () => {
    const res = await sendCodePOST(req('POST', 'http://localhost/x', { email: EMAIL }, 'not-a-pointer'));
    expect(res.status).toBe(401);
  });

  test('sends a fresh code for a prepared session', async () => {
    const sessionObj = {
      sessionId: SESSION, email: EMAIL, codeHash: 'a'.repeat(64), step: 'code_sent',
      codeSent: true, otpExpiresAt: Date.now() + 60000, attempts: 0, lastResendAt: Date.now(), expiresAt: Date.now() + 60000,
    };
    mockDb = makeDb({ ...baseDb(), admin_users: [{ id: A1, email: EMAIL, is_active: true, token_version: 0, password_hash: passHash, master_password_hash: masterHash, login_session_data: sessionObj }] });
    mockDb.rpcResults.set('prepare_admin_otp_resend', { data: { status: 'prepared' }, error: null });
    sendTelegramCodeMock.mockResolvedValue(true);
    const res = await sendCodePOST(req('POST', 'http://localhost/x', { email: EMAIL }, `${A1}.${SESSION}`));
    expect(res.status).toBe(200);
  });

  test('maps a cooldown status to 429', async () => {
    mockDb.rpcResults.set('prepare_admin_otp_resend', { data: { status: 'cooldown' }, error: null });
    const res = await sendCodePOST(req('POST', 'http://localhost/x', { email: EMAIL }, `${A1}.${SESSION}`));
    expect(res.status).toBe(429);
  });
});
