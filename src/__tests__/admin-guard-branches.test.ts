const verifyAdminToken = jest.fn();
let result: any = { data: null, error: null };
let throwClient = false;
const db = { from: jest.fn(() => { const api: any = { select: () => api, eq: () => api, maybeSingle: async () => result }; return api; }) };
jest.mock('@/lib/auth', () => ({ verifyAdminToken }));
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => { if (throwClient) throw new Error('config'); return db; } }));
import { requireAdmin, AdminAuthError, adminJsonError } from '@/lib/admin-guard';

const req = (token?: string, hasCookies = true) => hasCookies ? ({ cookies: { get: () => token ? { value: token } : undefined } } as any) : ({} as any);
beforeEach(() => { jest.clearAllMocks(); result = { data: null, error: null }; throwClient = false; verifyAdminToken.mockReturnValue({ userId: 'a1', ver: 0 }); });

describe('central admin guard branches', () => {
  test('rejects missing cookies/token and invalid JWT', async () => {
    await expect(requireAdmin(null as never)).rejects.toBeInstanceOf(AdminAuthError);
    await expect(requireAdmin(req(undefined, false))).rejects.toBeInstanceOf(AdminAuthError);
    await expect(requireAdmin(req())).rejects.toBeInstanceOf(AdminAuthError);
    verifyAdminToken.mockReturnValueOnce(null);
    await expect(requireAdmin(req('bad'))).rejects.toBeInstanceOf(AdminAuthError);
  });
  test('maps client configuration, lookup, inactive and stale identity failures', async () => {
    throwClient = true;
    await expect(requireAdmin(req('jwt'))).rejects.toMatchObject({ status: 500 });
    throwClient = false; result = { data: null, error: new Error('db') };
    await expect(requireAdmin(req('jwt'))).rejects.toMatchObject({ status: 401 });
    result = { data: { id: 'a1', is_active: false, token_version: 0 }, error: null };
    await expect(requireAdmin(req('jwt'))).rejects.toMatchObject({ status: 403 });
    result = { data: { id: 'a1', is_active: true, token_version: 2 }, error: null };
    await expect(requireAdmin(req('jwt'))).rejects.toMatchObject({ status: 401 });
  });
  test('normalizes successful admin strings and legacy version', async () => {
    result = { data: { id: 'a1', email: null, name: null, is_active: true, token_version: null }, error: null };
    await expect(requireAdmin(req('jwt'))).resolves.toEqual({ adminId: 'a1', email: '', name: '' });
    result.data.email = 'ADMIN@TEST.COM'; result.data.name = 'Admin';
    await expect(requireAdmin(req('jwt'))).resolves.toMatchObject({ email: 'admin@test.com', name: 'Admin' });
  });
  test('serializes known admin errors and keeps unknown errors generic', async () => {
    const known = adminJsonError(new AdminAuthError('No', 403));
    expect(known.status).toBe(403); expect((await known.json()).message).toBe('No');
    // Unknown errors (including internal ones) never leak their message.
    const unknown = adminJsonError(new Error('secret SQL'));
    expect(unknown.status).toBe(500);
    expect((await unknown.json()).message).toBe('حدث خطأ غير متوقع');
  });
  test('adminJsonError keeps internal details out of the payload for every shape', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // PostgREST-shaped object with a string message: generic + correlation id,
    // nothing of the internal message in the body.
    const objErr = await (await adminJsonError({ message: 'column missing', details: 'SQL hint' })).json();
    expect(objErr.message).toBe('حدث خطأ غير متوقع');
    expect(objErr.errorId).toMatch(/^[a-z0-9]+$/);
    expect(JSON.stringify(objErr)).not.toContain('column missing');
    expect(JSON.stringify(objErr)).not.toContain('SQL hint');
    // Object whose message is a non-string: generic.
    expect((await (await adminJsonError({ message: 42 })).json()).message).toBe('حدث خطأ غير متوقع');
    // Non-object values (string/null): generic.
    expect((await (await adminJsonError('boom')).json()).message).toBe('حدث خطأ غير متوقع');
    expect((await (await adminJsonError(null)).json()).message).toBe('حدث خطأ غير متوقع');
    // Error with empty message: generic too.
    expect((await (await adminJsonError(new Error(''))).json()).message).toBe('حدث خطأ غير متوقع');
    log.mockRestore();
  });
});
