const verifyAdminJwt = jest.fn();
const verifyPassword = jest.fn();
let maybeResult: { data: unknown; error: unknown } = { data: null, error: null };
type Row = Record<string, unknown>;
const inserts: Array<{ table: string; payload: Row }> = [];

const db = {
  from: jest.fn((table: string) => {
    const api: TestBuilder = {
      select: () => api,
      eq: () => api,
      maybeSingle: async () => maybeResult,
      insert: (payload: Row | Row[]) => { inserts.push({ table, payload: payload as Row }); return { error: null } as unknown as TestBuilder; },
    };
    return api;
  }),
};

jest.mock('@/lib/auth', () => ({ verifyAdminToken: verifyAdminJwt, verifyPassword }));
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { verifyAdminToken, verifyMasterPassword, auditLog } from '@/lib/admin-auth';

const request = (token?: string) => ({ cookies: { get: () => token ? { value: token } : undefined } }) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks(); inserts.length = 0; maybeResult = { data: null, error: null };
});

describe('legacy admin auth helpers', () => {
  test('rejects missing/invalid JWT and inactive or stale database identities', async () => {
    await expect(verifyAdminToken(request())).resolves.toBeNull();
    verifyAdminJwt.mockReturnValueOnce(null);
    await expect(verifyAdminToken(request('bad'))).resolves.toBeNull();
    verifyAdminJwt.mockReturnValue({ userId: 'a1', ver: 1 });
    maybeResult = { data: { id: 'a1', is_active: false, token_version: 1 }, error: null };
    await expect(verifyAdminToken(request('jwt'))).resolves.toBeNull();
    maybeResult = { data: { id: 'a1', is_active: true, token_version: 2 }, error: null };
    await expect(verifyAdminToken(request('jwt'))).resolves.toBeNull();
  });

  test('returns only the trusted active database admin with explicit/legacy token versions', async () => {
    verifyAdminJwt.mockReturnValueOnce({ userId: 'a1', ver: 0 });
    maybeResult = { data: { id: 'a1', is_active: true, token_version: null }, error: null };
    await expect(verifyAdminToken(request('jwt'))).resolves.toEqual({ userId: 'a1', role: 'superadmin' });
    verifyAdminJwt.mockReturnValue({ userId: 'a1', ver: 3 });
    maybeResult = { data: { id: 'a1', is_active: true, token_version: 3 }, error: null };
    await expect(verifyAdminToken(request('jwt'))).resolves.toEqual({ userId: 'a1', role: 'superadmin' });
  });

  test('fails closed when admin database access throws', async () => {
    verifyAdminJwt.mockReturnValue({ userId: 'a1', ver: 0 });
    db.from.mockImplementationOnce(() => { throw new Error('db'); });
    await expect(verifyAdminToken(request('jwt'))).resolves.toBeNull();
    db.from.mockImplementationOnce(() => { throw new Error('db'); });
    await expect(verifyMasterPassword('a1', 'secret')).resolves.toBe(false);
  });

  test('verifies the stored master hash and fails closed', async () => {
    await expect(verifyMasterPassword('', 'x')).resolves.toBe(false);
    maybeResult = { data: null, error: null };
    await expect(verifyMasterPassword('a1', 'secret')).resolves.toBe(false);
    maybeResult = { data: { master_password_hash: 'hash' }, error: null };
    verifyPassword.mockResolvedValueOnce(true);
    await expect(verifyMasterPassword('a1', 'secret')).resolves.toBe(true);
    expect(verifyPassword).toHaveBeenCalledWith('secret', 'hash');
  });

  test('bounds audit fields and treats logging as best effort', async () => {
    await auditLog('a1', 'x'.repeat(100), 'd'.repeat(3000), 'type'.repeat(20), 'id'.repeat(40), '1'.repeat(100));
    expect(inserts[0].payload.action).toHaveLength(64);
    expect(inserts[0].payload.details).toHaveLength(2000);
    expect(inserts[0].payload.target_type).toHaveLength(32);
    expect(inserts[0].payload.target_id).toHaveLength(64);
    expect(inserts[0].payload.ip_address).toHaveLength(64);

    db.from.mockImplementationOnce(() => ({ insert: async () => { throw new Error('down'); } }) as unknown as TestBuilder);
    await expect(auditLog('a1', 'login')).resolves.toBeUndefined();
  });
});
