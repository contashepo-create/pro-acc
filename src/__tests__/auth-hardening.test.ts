/**
 * Auth hardening tests — Section 1 (Authentication & platform security)
 *
 * Covers the fixes applied in this section:
 * 1. Password policy (min 8, max 128, common-password blocklist)
 *    applied to register/reset/setup, while login stays permissive (legacy).
 * 2. Rate-limit email sanitization against PostgREST `.or()` filter injection.
 * 3. Stateless math-CAPTCHA verification (valid/wrong/tampered/expired).
 * 4. Register route rejects requests that omit the CAPTCHA entirely.
 * 5. Double-submit CSRF check semantics (timing-safe, method-aware).
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.CSRF_BYPASS = 'false';
// Force the math-CAPTCHA path (no Turnstile) in this test environment.
delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
delete process.env.TURNSTILE_SECRET_KEY;

import {
  passwordPolicy,
  registerSchema,
  resetPasswordSchema,
  loginSchema,
  isCommonPassword,
} from '@/lib/validation';
import { sanitizeEmailForFilter } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/api-helpers';

// email lib is imported by the register route; stub it so the route module
// can be imported in a node test environment.
jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn(async () => false),
  sendPasswordResetEmail: jest.fn(async () => false),
}));

import { POST as registerPOST, GET as registerGET } from '@/app/api/auth/register/route';

// ---------------------------------------------------------------------------

describe('Password policy (zod)', () => {
  test('rejects passwords shorter than 8 chars', () => {
    expect(passwordPolicy.safeParse('Ab1!xyz').success).toBe(false);
    expect(passwordPolicy.safeParse('').success).toBe(false);
  });

  test('rejects common passwords even if long enough', () => {
    expect(passwordPolicy.safeParse('12345678').success).toBe(false);
    expect(passwordPolicy.safeParse('password').success).toBe(false);
    expect(passwordPolicy.safeParse('PASSWORD1').success).toBe(false); // case-insensitive
    expect(passwordPolicy.safeParse('كلمةالمرور').success).toBe(false);
  });

  test('rejects passwords longer than 128 chars', () => {
    expect(passwordPolicy.safeParse('X9!k'.repeat(40)).success).toBe(false);
  });

  test('accepts a strong, uncommon password (latin & arabic)', () => {
    expect(passwordPolicy.safeParse('Str0ng!Passw0rd').success).toBe(true);
    expect(passwordPolicy.safeParse('محاسبة@آمنة2026').success).toBe(true);
  });

  test('isCommonPassword is case-insensitive', () => {
    expect(isCommonPassword('QwErTy')).toBe(true);
    expect(isCommonPassword('N0tInTh3L!st')).toBe(false);
  });
});

describe('Schema wiring', () => {
  test('registerSchema enforces email format and password policy', () => {
    expect(
      registerSchema.safeParse({
        companyName: 'شركة', name: 'أحمد', email: 'not-an-email', password: 'Str0ng!Pass',
      }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        companyName: 'شركة', name: 'أحمد', email: 'a@b.com', password: '123456',
      }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        companyName: 'شركة', name: 'أحمد', email: 'a@b.com', password: 'Str0ng!Pass',
      }).success
    ).toBe(true);
  });

  test('resetPasswordSchema enforces password policy', () => {
    expect(resetPasswordSchema.safeParse({ token: 't', password: '123456' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: 'a'.repeat(64), password: 'Str0ng!Pass' }).success).toBe(true);
  });

  test('loginSchema stays permissive for legacy 6-char passwords', () => {
    expect(
      loginSchema.safeParse({ email: 'a@b.com', password: '123456' }).success
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('Rate-limit email sanitization (PostgREST injection)', () => {
  test('strips filter-syntax characters from crafted emails', () => {
    const malicious = 'a@b.com,or(id.neq.null)';
    const sanitized = sanitizeEmailForFilter(malicious);
    expect(sanitized).not.toContain(',');
    expect(sanitized).not.toContain('(');
    expect(sanitized).not.toContain(')');
    expect(sanitized).not.toContain('"');
    expect(sanitized).not.toContain("'");
  });

  test('keeps valid emails intact and lowercases them', () => {
    expect(sanitizeEmailForFilter('User.Name+tag@Example.COM')).toBe('user.name+tag@example.com');
  });

  test('falls back to a non-matching sentinel for fully invalid input', () => {
    const s = sanitizeEmailForFilter('()()(),,,');
    expect(s).toBe('invalid-email@example.invalid');
  });

  test('allowlist only [a-z0-9._%+-@]', () => {
    expect(sanitizeEmailForFilter('a b@c.com')).toBe('ab@c.com');
    expect(sanitizeEmailForFilter('x;DROP@y.com')).toBe('xdrop@y.com');
    // ':' is filter syntax in PostgREST and must be stripped; '.' is a
    // legitimate email character and is harmless inside an eq filter value.
    expect(sanitizeEmailForFilter('x:eq.true@y.com')).toBe('xeq.true@y.com');
    expect(sanitizeEmailForFilter('x:eq.true@y.com')).not.toContain(':');
  });
});

// ---------------------------------------------------------------------------

describe('Stateless math CAPTCHA', () => {
  async function makeChallenge() {
    const res = await registerGET({} as any);
    const json = await res.json();
    return json.data;
  }

  test('GET issues a challenge and verifies the correct answer', async () => {
    const { question, challengeId } = await makeChallenge();
    expect(typeof challengeId).toBe('string');
    const [a, , b] = question.split(' ');
    const answer = Number(a) + Number(b);
    const { verifyCaptchaToken } = await import('@/app/api/auth/register/route');
    expect(verifyCaptchaToken(challengeId, answer)).toBe(true);
    expect(verifyCaptchaToken(challengeId, answer + 1)).toBe(false);
  });

  test('rejects tampered challenge payloads', async () => {
    const { verifyCaptchaToken } = await import('@/app/api/auth/register/route');
    const { createHmac } = await import('crypto');
    const payload = '5:7:12:9999999999999';
    const sig = createHmac('sha256', 'attacker-secret').update(payload).digest('hex');
    const forged = Buffer.from(`${payload}:${sig}`).toString('base64url');
    expect(verifyCaptchaToken(forged, 12)).toBe(false);
    expect(verifyCaptchaToken('not-valid-base64!!!', 1)).toBe(false);
  });

  test('rejects expired challenges even with a valid signature', async () => {
    const { verifyCaptchaToken } = await import('@/app/api/auth/register/route');
    const { createHmac } = await import('crypto');
    const past = Date.now() - 60 * 60 * 1000;
    const payload = `5:7:12:${past}`;
    const sig = createHmac('sha256', process.env.TOKEN_SECRET!).update(payload).digest('hex');
    const expired = Buffer.from(`${payload}:${sig}`).toString('base64url');
    expect(verifyCaptchaToken(expired, 12)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Register route — CAPTCHA mandatory', () => {
  function fakeRequest(body: any) {
    return {
      json: async () => body,
      headers: { get: () => null },
    } as any;
  }

  test('rejects registration that omits CAPTCHA fields entirely', async () => {
    // CAPTCHA_ENABLED defaults to true and no Turnstile key in test env
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    const res = await registerPOST(fakeRequest({
      companyName: 'شركة الاختبار',
      name: 'مستخدم',
      email: 'user@example.com',
      password: 'Str0ng!Passw0rd',
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('التحقق الأمني');
  });

  test('rejects registration with a wrong CAPTCHA answer', async () => {
    const { challengeId } = await (await registerGET({} as any)).json().then((j: any) => j.data);
    const res = await registerPOST(fakeRequest({
      companyName: 'شركة الاختبار',
      name: 'مستخدم',
      email: 'user@example.com',
      password: 'Str0ng!Passw0rd',
      captchaId: challengeId,
      captchaAnswer: -999,
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Double-submit CSRF check', () => {
  function fakeRequest(method: string, header?: string, cookie?: string) {
    return {
      method,
      headers: { get: (k: string) => (k === 'x-csrf-token' ? header ?? null : null) },
      cookies: {
        get: (k: string) => (k === 'csrf_token' && cookie !== undefined ? { value: cookie } : undefined),
      },
    } as any;
  }

  test('allows safe methods without token', () => {
    expect(checkCsrf(fakeRequest('GET'))).toBe(true);
    expect(checkCsrf(fakeRequest('HEAD'))).toBe(true);
  });

  test('rejects POST without token or with mismatched token', () => {
    expect(checkCsrf(fakeRequest('POST'))).toBe(false);
    expect(checkCsrf(fakeRequest('POST', 'abc', 'abd'))).toBe(false);
    expect(checkCsrf(fakeRequest('POST', 'abc', 'abcd'))).toBe(false); // length mismatch
    expect(checkCsrf(fakeRequest('POST', 'abc', undefined))).toBe(false);
  });

  test('accepts POST with matching double-submit token', () => {
    expect(checkCsrf(fakeRequest('POST', 'deadbeef'.repeat(8), 'deadbeef'.repeat(8)))).toBe(true);
  });
});
