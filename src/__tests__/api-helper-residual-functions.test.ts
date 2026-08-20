const extractToken = jest.fn(() => 'token');
const verifyToken = jest.fn(() => ({ userId: 'u1', ver: 0 }));
const getCompanySubscription = jest.fn();
const assertSubscriptionAccess = jest.fn(async () => undefined);
const hitRateLimit = jest.fn(() => ({ allowed: true, retryAfterSeconds: 0 }));
let userResult: any = { data: { company_id: 'c1', is_active: true, role: 'admin', token_version: 0 }, error: null };
let companyResult: any = { data: { is_active: true }, error: null };

const db = {
  from: jest.fn((table: string) => {
    const api: any = { select: () => api, eq: () => api, single: async () => table === 'users' ? userResult : companyResult };
    return api;
  }),
};

jest.mock('@/lib/auth', () => ({ extractToken, verifyToken }));
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));
jest.mock('@/lib/subscription', () => ({ getCompanySubscription }));
jest.mock('@/lib/subscription-guard', () => ({ assertSubscriptionAccess }));
jest.mock('@/lib/memory-rate-limit', () => ({ hitRateLimit, READ_LIMIT: 100, WRITE_LIMIT: 20 }));

import { z } from 'zod';
import { NextResponse } from 'next/server';
import {
  unauthorized, validationError, requireApiAuth, requireApiAuthWithSubscription, parseValidatedBody,
  ValidationFailure, RateLimitExceeded, escapeHtml, requireCsrf, AuthError,
  clearAuthCookie, setAuthCookie, handleApiError,
} from '@/lib/api-helpers';

const request = (method = 'GET', body: unknown = {}) => ({
  url: 'http://localhost/api/test', method,
  headers: new Headers({ 'x-csrf-token': 'secret' }),
  cookies: { get: (name: string) => name === 'csrf_token' ? { value: 'secret' } : undefined },
  json: async () => body,
}) as any;

beforeEach(() => {
  jest.clearAllMocks();
  extractToken.mockReturnValue('token');
  verifyToken.mockReturnValue({ userId: 'u1', ver: 0 });
  userResult = { data: { company_id: 'c1', is_active: true, role: 'admin', token_version: 0 }, error: null };
  companyResult = { data: { is_active: true }, error: null };
  hitRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

describe('remaining API helper functions', () => {
  test('builds unauthorized and structured validation responses', async () => {
    const unauth = unauthorized();
    expect(unauth.status).toBe(401);
    expect((await unauth.json()).message).toBe('Unauthorized');
    const invalid = validationError({ name: ['required'] });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).errors).toEqual({ name: ['required'] });
  });

  test('runs subscription-aware authentication through the entitlement guard', async () => {
    await expect(requireApiAuthWithSubscription(request())).resolves.toEqual({ companyId: 'c1', userId: 'u1', role: 'admin' });
    expect(assertSubscriptionAccess).toHaveBeenCalledWith('c1', 'GET', '/api/test');
  });

  test('executes the legacy expiry-only subscription branch when explicitly requested', async () => {
    getCompanySubscription.mockResolvedValueOnce({ is_expired: false });
    await expect(requireApiAuth(request(), { checkSubscription: true, skipModuleGuard: true })).resolves.toMatchObject({ companyId: 'c1' });
    expect(getCompanySubscription).toHaveBeenCalledWith('c1');
    getCompanySubscription.mockResolvedValueOnce({ is_expired: true });
    await expect(requireApiAuth(request(), { checkSubscription: true, skipModuleGuard: true })).rejects.toMatchObject({ status: 403 });
  });

  test('validates parsed bodies and returns flattened field errors', async () => {
    const schema = z.object({ name: z.string().min(2) });
    await expect(parseValidatedBody(request('POST', { name: 'ok' }), schema)).resolves.toEqual({ name: 'ok' });
    await expect(parseValidatedBody(request('POST', { name: '' }), schema)).rejects.toBeInstanceOf(ValidationFailure);
    const customSchema = { safeParse: () => ({ success: false, error: 'plain-error' }) };
    await expect(parseValidatedBody(request('POST', {}), customSchema)).rejects.toMatchObject({ errors: 'plain-error' });
  });

  test('escapes HTML and enforces matching CSRF tokens', () => {
    expect(escapeHtml(`<a x="1">Tom & 'A'</a>`)).toBe('&lt;a x=&quot;1&quot;&gt;Tom &amp; &#39;A&#39;&lt;/a&gt;');
    expect(() => requireCsrf(request('POST'))).not.toThrow();
    const bad = request('POST'); bad.headers = new Headers({ 'x-csrf-token': 'wrong' });
    expect(() => requireCsrf(bad)).toThrow(AuthError);
  });

  test('sets and clears secure session cookies', () => {
    const response = NextResponse.json({});
    setAuthCookie(response, 'token', 'value', 60);
    expect(response.cookies.get('token')?.value).toBe('value');
    clearAuthCookie(response, 'token');
    expect(response.cookies.get('token')?.value).toBe('');
  });

  test('maps rate limit constructors through the API error handler', async () => {
    const cause = new RateLimitExceeded(12);
    const response = handleApiError(cause);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect((await response.json()).message).toContain('عدد كبير');
  });
});
