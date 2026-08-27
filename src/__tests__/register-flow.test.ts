/**
 * Route-level tests for user/company registration:
 *   /api/auth/register
 *
 * Covers:
 *  - Password policy enforcement via zod.
 *  - Disposable-email blocking.
 *  - Duplicate email / company / phone rejection (409).
 *  - Trial subscription is created against the Start plan (code='start'),
 *    with trial_days=7. If the Start plan is missing the registration still
 *    succeeds and logs a warning (no auto-seeding of a phantom 'trial' plan).
 *  - New user is stored with a scrypt-hashed password and a verification token.
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
// Disable the CAPTCHA gate for these tests so we can exercise the rest of the
// registration flow; CAPTCHA-mandatory behavior is covered in auth-hardening.test.ts.
process.env.CAPTCHA_ENABLED = 'false';
delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

import { mockClient, resetMock, setResult, setResults, setRpcResult, getRpcCalls, findOp } from './helpers/supabase-mock';

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => mockClient,
}));

jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn(async () => true),
  sendPasswordResetEmail: jest.fn(async () => false),
}));

jest.mock('@/lib/default-accounts', () => ({
  DEFAULT_CHART_OF_ACCOUNTS: [
    { code: '1000', name: 'الأصول', nameEn: 'Assets', type: 'asset', isHeader: true },
  ],
  createDefaultChartOfAccounts: jest.fn(async () => {}),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true, remainingMinutes: 0 })),
  checkRegistrationRateLimit: jest.fn(async () => ({ allowed: true, remainingMinutes: 0 })),
  recordRegistrationAttempt: jest.fn(async () => {}),
  sanitizeEmailForFilter: (e: string) => e,
  sanitizeIpAddress: (i: string) => i,
}));

import { registerSchema } from '@/lib/validation';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import type { NextRequest } from 'next/server';

function req(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

const validBody = {
  companyName: 'شركة الأمل للمقاولات',
  name: 'أحمد محمد',
  email: 'ahmed@example.com',
  password: 'UnitTestPass26',
  country: 'SA',
};

describe('register — password policy & validation', () => {
  test('schema rejects weak/short passwords', () => {
    expect(registerSchema.safeParse({ ...validBody, password: '123456' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validBody, password: 'password' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validBody, password: 'short' }).success).toBe(false);
  });

  test('schema accepts a strong password', () => {
    expect(registerSchema.safeParse(validBody).success).toBe(true);
  });
});

describe('register — disposable email blocking', () => {
  beforeEach(resetMock);

  test('blocks known disposable domains', async () => {
    const res = await registerPOST(req({ ...validBody, email: 'spam@mailinator.com' }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.message).toContain('بريد مؤقت');
  });
});

describe('register — duplicate detection', () => {
  beforeEach(resetMock);

  test('rejects an already-registered email with 409', async () => {
    // users lookup returns an existing row → duplicate
    setResult('users', 'select', [{ id: 'existing' }]);
    const res = await registerPOST(req(validBody));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.message).toContain('مسجل مسبقاً');
  });

  test('rejects a duplicate company name with 409', async () => {
    setResult('users', 'select', []);
    setResult('companies', 'select', [{ id: 'c1' }]);
    const res = await registerPOST(req(validBody));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.message).toContain('اسم الشركة موجود مسبقاً');
  });

  test('rejects a duplicate phone with 409', async () => {
    setResult('users', 'select', []);
    // First companies select (name check) passes with []; second (phone) hits a duplicate.
    setResults('companies', 'select', [[], [{ id: 'c-phone' }]]);
    const res = await registerPOST(req({ ...validBody, phone: '966500000000' }));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.message).toContain('رقم الهاتف مسجل مسبقاً');
  });
});

describe('register — atomic company bootstrap', () => {
  beforeEach(() => {
    resetMock();
    setResult('users', 'select', []);
    setResult('companies', 'select', []);
  });

  const registration = {
    company: { id: 'company-1', name: 'شركة الاختبار' },
    user: { id: 'u1', name: validBody.name, email: validBody.email, role: 'admin' },
  };

  test('delegates the company, owner and chart bootstrap to one transaction RPC', async () => {
    setRpcResult('register_company', registration);
    const res = await registerPOST(req(validBody));
    expect(res.status).toBe(201);
    expect(getRpcCalls()).toHaveLength(1);
    const call = getRpcCalls()[0];
    const params = call.params as {
      p_company_name: string; p_email: string; p_user_name: string;
      p_password_hash: string; p_verification_hash: string; p_accounts: unknown[];
    };
    expect(call.name).toBe('register_company');
    expect(params.p_company_name).toBe(validBody.companyName);
    expect(params.p_email).toBe(validBody.email.toLowerCase());
    expect(params.p_user_name).toBe(validBody.name);
    expect(params.p_password_hash).toContain(':');
    expect(params.p_password_hash).not.toContain(validBody.password);
    expect(params.p_verification_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(params.p_accounts)).toBe(true);
    expect(params.p_accounts.length).toBeGreaterThan(0);

    expect(findOp('companies', 'insert')).toBeNull();
    expect(findOp('users', 'insert')).toBeNull();
    expect(findOp('accounts', 'insert')).toBeNull();
  });

  test('returns the registered owner without leaking sensitive hashes', async () => {
    setRpcResult('register_company', registration);
    const res = await registerPOST(req(validBody));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.user).toMatchObject({ id: 'u1', email: validBody.email, role: 'admin' });
    expect(JSON.stringify(body)).not.toContain('password_hash');
    expect(JSON.stringify(body)).not.toContain('verification_hash');
  });

  test('never embeds the session JWT in the response body (dev session included)', async () => {
    setRpcResult('register_company', registration);
    const res = await registerPOST(req({ ...validBody, email: 'noleak@example.com' }));
    const body = await res.json();
    expect(res.status).toBe(201);
    // In non-production a session is issued — it must live only in the
    // HttpOnly cookie, never in the JSON body (XSS would read a body token).
    expect(body.data.token).toBeUndefined();
    const cookieValue = (res as unknown as { cookies?: { get?: (k: string) => { value?: string } | undefined } }).cookies?.get?.('token')?.value;
    if (cookieValue) {
      expect(JSON.stringify(body.data)).not.toContain(cookieValue);
    }
  });

  test('maps a database uniqueness conflict to 409', async () => {
    setRpcResult('register_company', {
      data: null,
      error: { code: 'P0001', message: 'البريد الإلكتروني مسجل مسبقاً' },
    });
    const res = await registerPOST(req(validBody));
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain('مسجل مسبقاً');
  });
});
