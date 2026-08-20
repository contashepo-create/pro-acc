const extractToken = jest.fn(() => 'token');
const verifyToken = jest.fn(() => ({ userId: 'u1', ver: 0 }));
const getCompanySubscription = jest.fn();
const assertSubscriptionAccess = jest.fn(async () => undefined);
const hasModulePermission = jest.fn(async () => true);
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
jest.mock('@/lib/permissions', () => ({ hasModulePermission }));
jest.mock('@/lib/memory-rate-limit', () => ({ hitRateLimit, READ_LIMIT: 100, WRITE_LIMIT: 20 }));

import { z } from 'zod';
import { NextResponse } from 'next/server';
import {
  success, error, serverError, unauthorized, validationError, requireApiAuth, requireApiAuthWithSubscription,
  requireModulePermission, parseBody, parseValidatedBody, ValidationFailure, BusinessRuleError,
  RateLimitExceeded, enforceRateLimit, escapeHtml, requireCsrf, AuthError,
  getPaginationParams, getDateRangeParams, clearAuthCookie, setAuthCookie, handleApiError,
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

  test('handles subscription guard AuthErrors, production write failures and read fail-open', async () => {
    assertSubscriptionAccess.mockRejectedValueOnce(new AuthError('blocked', 403));
    await expect(requireApiAuth(request(), {})).rejects.toThrow('blocked');
    const saved = process.env.NODE_ENV; (process.env as any).NODE_ENV = 'production';
    assertSubscriptionAccess.mockRejectedValueOnce(new Error('guard down'));
    await expect(requireApiAuth(request('POST'), {})).rejects.toMatchObject({ status: 503 });
    assertSubscriptionAccess.mockRejectedValueOnce(new Error('guard down'));
    await expect(requireApiAuth(request('GET'), {})).resolves.toMatchObject({ companyId: 'c1' });
    (process.env as any).NODE_ENV = saved;
  });

  test('executes the legacy expiry-only subscription branch when explicitly requested', async () => {
    getCompanySubscription.mockResolvedValueOnce({ is_expired: false });
    await expect(requireApiAuth(request(), { checkSubscription: true, skipModuleGuard: true })).resolves.toMatchObject({ companyId: 'c1' });
    expect(getCompanySubscription).toHaveBeenCalledWith('c1');
    getCompanySubscription.mockResolvedValueOnce({ is_expired: true });
    await expect(requireApiAuth(request(), { checkSubscription: true, skipModuleGuard: true })).rejects.toMatchObject({ status: 403 });
    getCompanySubscription.mockRejectedValueOnce(new Error('legacy down'));
    await expect(requireApiAuth(request(), { checkSubscription: true, skipModuleGuard: true })).resolves.toMatchObject({ companyId: 'c1' });
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

  test('applies optional cache responses and serializes all safe error shapes', async () => {
    expect(success({ ok: true }, 201, { cache: 'public', maxAge: 10 }).status).toBe(201);
    expect(error('bad', 418).status).toBe(418);
    const oldEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'test';
    for (const cause of [new Error('E1'), { message: 'E2', details: 'D' }, { msg: 'E3', hint: 'H' }, { error: { message: 'E4' } }, { error: { message: '' } }, null]) {
      const body = await serverError(cause).json();
      expect(body.success).toBe(false);
    }
    (process.env as any).NODE_ENV = 'production';
    expect((await serverError(new Error('secret')).json()).message).toBe('حدث خطأ في الخادم');
    (process.env as any).NODE_ENV = oldEnv;
  });

  test('rejects every authentication identity failure branch', async () => {
    extractToken.mockReturnValueOnce(null as any);
    await expect(requireApiAuth(request())).rejects.toMatchObject({ status: 401 });
    verifyToken.mockReturnValueOnce(null as any);
    await expect(requireApiAuth(request())).rejects.toMatchObject({ status: 401 });
    userResult = { data: null, error: new Error('user') };
    await expect(requireApiAuth(request())).rejects.toThrow('المستخدم غير موجود');
    userResult = { data: { company_id: 'c1', is_active: false, role: 'admin', token_version: 0 }, error: null };
    await expect(requireApiAuth(request())).rejects.toMatchObject({ status: 403 });
    userResult = { data: { company_id: 'c1', is_active: true, role: 'admin', token_version: 2 }, error: null };
    await expect(requireApiAuth(request())).rejects.toMatchObject({ status: 401 });
    userResult = { data: { company_id: 'c1', is_active: true, role: 'admin', token_version: 0 }, error: null };
    companyResult = { data: null, error: new Error('company') };
    await expect(requireApiAuth(request())).rejects.toMatchObject({ status: 503 });
    companyResult = { data: { is_active: false }, error: null };
    await expect(requireApiAuth(request())).rejects.toMatchObject({ status: 403 });
  });

  test('checks custom module permissions for non-admin users', async () => {
    userResult = { data: { company_id: 'c1', is_active: true, role: 'accountant', token_version: 0 }, error: null };
    hasModulePermission.mockResolvedValueOnce(true);
    await expect(requireModulePermission(request(), 'journal', 'read')).resolves.toMatchObject({ role: 'accountant' });
    hasModulePermission.mockResolvedValueOnce(false);
    await expect(requireModulePermission(request(), 'journal', 'delete')).rejects.toMatchObject({ status: 403 });
  });

  test('maps business, fiscal and validation errors without leaking database errors', async () => {
    expect(handleApiError(new BusinessRuleError('rule', 409)).status).toBe(409);
    expect((await handleApiError({ message: 'cannot post to a closed fiscal year' }).json()).message).toContain('مقفلة');
    expect((await handleApiError({ message: 'لا توجد سنة مالية مفتوحة تغطي تاريخ العملية' }).json()).message).toContain('خارج نطاق');
    expect(handleApiError(new ValidationFailure('invalid', { field: ['bad'] })).status).toBe(422);
    expect((await handleApiError(new ValidationFailure('message-only')).json()).errors).toBe('message-only');
    expect(handleApiError(null).status).toBe(500);
  });

  test('covers rate-limit, body, csrf and pagination edge branches', async () => {
    hitRateLimit.mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0 });
    await expect(enforceRateLimit(null as any, 'u')).resolves.toBeUndefined();
    hitRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 9 });
    await expect(enforceRateLimit(request('POST'), 'u')).rejects.toBeInstanceOf(RateLimitExceeded);
    for (const value of [null, [], 'x']) await expect(parseBody(request('POST', value))).rejects.toBeInstanceOf(ValidationFailure);
    const oldBypass = process.env.CSRF_BYPASS; process.env.CSRF_BYPASS = 'true';
    expect(() => requireCsrf({ ...request('POST'), headers: new Headers() })).not.toThrow();
    if (oldBypass === undefined) delete process.env.CSRF_BYPASS; else process.env.CSRF_BYPASS = oldBypass;
    const missing = request('POST'); missing.headers = new Headers(); missing.cookies = { get: () => undefined };
    expect(() => requireCsrf(missing)).toThrow();
    const noCookies = request('POST'); noCookies.cookies = undefined;
    expect(() => requireCsrf(noCookies)).toThrow();
    const unequal = request('POST'); unequal.headers = new Headers({ 'x-csrf-token': 'long' });
    expect(() => requireCsrf(unequal)).toThrow();
    expect(getPaginationParams(new URL('http://x?page=2&pageSize=999'))).toEqual({ page: 2, pageSize: 500 });
    expect(getPaginationParams('http://x?page=bad&pageSize=-1')).toEqual({ page: 1, pageSize: 1 });
    expect(getPaginationParams('http://x')).toEqual({ page: 1, pageSize: 50 });
    expect(getDateRangeParams(new URL('http://x?from=2026-01-01&to=2026-02-01'))).toEqual({ from: '2026-01-01', to: '2026-02-01' });
    expect(getDateRangeParams('http://x')).toEqual({ from: null, to: null });
  });

  test('maps rate limit constructors through the API error handler', async () => {
    const cause = new RateLimitExceeded(12);
    const response = handleApiError(cause);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect((await response.json()).message).toContain('عدد كبير');
  });
});
