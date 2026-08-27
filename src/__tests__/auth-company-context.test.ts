process.env.TOKEN_SECRET = 'test-only-company-context-secret-32-chars';
const query = jest.fn();
jest.mock('@/lib/db', () => ({ query }));

import { createToken, getCompanyContext } from '@/lib/auth';

const request = (token?: string, cookieToken?: string) => ({
  headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
  cookies: { get: () => cookieToken ? { value: cookieToken } : undefined },
}) as unknown as Request;

beforeEach(() => jest.clearAllMocks());

describe('getCompanyContext', () => {
  test('returns null without or with an invalid token', async () => {
    await expect(getCompanyContext(request())).resolves.toBeNull();
    await expect(getCompanyContext({ headers: new Headers({ authorization: 'Basic x' }) } as unknown as Request)).resolves.toBeNull();
    await expect(getCompanyContext(request('invalid'))).resolves.toBeNull();
  });

  test('loads authoritative tenant and role for bearer/cookie tokens', async () => {
    const token = createToken('u1', 'supervisor', 2);
    query.mockResolvedValue({ rows: [{ company_id: 'c1', token_version: 2, role: 'accountant' }] });
    await expect(getCompanyContext(request(token))).resolves.toEqual({ companyId: 'c1', userId: 'u1', role: 'accountant' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('JOIN companies'), ['u1']);
    query.mockResolvedValue({ rows: [{ company_id: 'c1', token_version: 2, role: 'manager' }] });
    await expect(getCompanyContext(request(undefined, token))).resolves.toMatchObject({ role: 'manager' });
    const legacy = createToken('u1', 'admin', 0);
    query.mockResolvedValue({ rows: [{ company_id: 'c1', token_version: null, role: 'admin' }] });
    await expect(getCompanyContext(request(legacy))).resolves.toMatchObject({ role: 'admin' });
  });

  test('rejects missing users, stale versions and database failures', async () => {
    const token = createToken('u1', 'admin', 1);
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getCompanyContext(request(token))).resolves.toBeNull();
    query.mockResolvedValueOnce({ rows: [{ company_id: 'c1', token_version: 2, role: 'admin' }] });
    await expect(getCompanyContext(request(token))).resolves.toBeNull();
    query.mockRejectedValueOnce(new Error('db'));
    await expect(getCompanyContext(request(token))).resolves.toBeNull();
  });
});
