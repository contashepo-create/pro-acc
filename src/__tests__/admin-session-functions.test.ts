const updates: any[] = [];
let readResult: any = { data: null, error: null };
let writeResult: any = { data: { id: 'admin' }, error: null };
let containsError: any = null;

const db = {
  from: jest.fn(() => {
    let mode = 'read';
    const api: any = {
      select: () => api,
      update: (value: any) => { mode = 'update'; updates.push(value); return api; },
      eq: () => api,
      contains: () => api,
      maybeSingle: async () => mode === 'update' ? writeResult : readResult,
      single: async () => readResult,
      then: (resolve: any, reject: any) => Promise.resolve({ data: null, error: containsError }).then(resolve, reject),
    };
    return api;
  }),
};

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import {
  parseAdminSessionPointer, setSession, getSession, updateSession, deleteSession, cleanupExpiredSessions,
  type AdminSessionData,
} from '@/lib/admin-session';

const ADMIN = '90000000-0000-4000-8000-000000000001';
const NONCE = 'a'.repeat(64);
const HASH = 'b'.repeat(64);
const pointer = `${ADMIN}.${NONCE}`;
const validSession = (patch: Partial<AdminSessionData> = {}): AdminSessionData => ({
  sessionId: NONCE, email: 'admin@example.com', codeHash: HASH, step: 'telegram_verified',
  codeSent: true, otpExpiresAt: Date.now() + 60_000, attempts: 0, lastResendAt: 0,
  expiresAt: Date.now() + 120_000, ...patch,
});

beforeEach(() => {
  jest.clearAllMocks(); updates.length = 0;
  readResult = { data: null, error: null };
  writeResult = { data: { id: ADMIN }, error: null };
  containsError = null;
});

describe('admin session pointer and persistence', () => {
  test('parses only a UUID plus a 256-bit nonce', () => {
    expect(parseAdminSessionPointer(pointer)).toEqual({ adminId: ADMIN, sessionId: NONCE });
    for (const bad of ['', ADMIN, `${ADMIN}.short`, `bad.${NONCE}`, `${ADMIN}.${NONCE}.extra`]) {
      expect(parseAdminSessionPointer(bad)).toBeNull();
    }
  });

  test('validates and stores hashes rather than plaintext OTPs', async () => {
    await expect(setSession('bad', validSession())).rejects.toThrow('Invalid admin session data');
    await expect(setSession(ADMIN, validSession({ codeHash: 'plaintext' }))).rejects.toThrow('Invalid admin session data');
    await setSession(ADMIN, validSession());
    expect(updates[0]).toMatchObject({ telegram_code: HASH, master_verified: false });
    expect(updates[0].login_session_data.sessionId).toBe(NONCE);
    writeResult = { data: null, error: null };
    await expect(setSession(ADMIN, validSession())).rejects.toThrow('Admin session owner not found');
  });

  test('loads active matching sessions and rejects inactive/mismatched rows', async () => {
    readResult = { data: { is_active: true, login_session_data: validSession() }, error: null };
    await expect(getSession(pointer)).resolves.toMatchObject({ email: 'admin@example.com' });
    readResult = { data: { is_active: false, login_session_data: validSession() }, error: null };
    await expect(getSession(pointer)).resolves.toBeNull();
    readResult = { data: { is_active: true, login_session_data: validSession({ sessionId: 'c'.repeat(64) }) }, error: null };
    await expect(getSession(pointer)).resolves.toBeNull();
    await expect(getSession('bad')).resolves.toBeNull();
  });

  test('deletes expired overall and OTP sessions', async () => {
    readResult = { data: { is_active: true, login_session_data: validSession({ expiresAt: Date.now() - 1 }) }, error: null };
    await expect(getSession(pointer)).resolves.toBeNull();
    expect(updates.at(-1)).toMatchObject({ login_session_data: null });

    readResult = { data: { is_active: true, login_session_data: validSession({ step: 'code_sent', otpExpiresAt: Date.now() - 1 }) }, error: null };
    await expect(getSession(pointer)).resolves.toBeNull();
  });

  test('updates mutable fields but keeps session id immutable', async () => {
    readResult = { data: { is_active: true, login_session_data: validSession() }, error: null };
    await updateSession(pointer, { attempts: 2, sessionId: 'd'.repeat(64) });
    expect(updates.at(-1).login_session_data).toMatchObject({ attempts: 2, sessionId: NONCE });
    await expect(updateSession('bad', {})).rejects.toThrow('Invalid admin session');
    readResult = { data: null, error: null };
    await expect(updateSession(pointer, {})).rejects.toThrow('Admin session expired');
  });

  test('deletes only nonce-bound sessions and surfaces database errors', async () => {
    await expect(deleteSession('bad')).resolves.toBeUndefined();
    await deleteSession(pointer);
    expect(updates.at(-1)).toEqual({ telegram_code: null, telegram_code_expires: null, master_verified: false, login_session_data: null });
    containsError = new Error('db');
    await expect(deleteSession(pointer)).rejects.toThrow('db');
    await expect(cleanupExpiredSessions()).resolves.toBeUndefined();
  });
});
