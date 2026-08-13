/**
 * Route-level tests for user/company registration:
 *   /api/auth/register
 *
 * Covers:
 *  - Password policy enforcement via zod.
 *  - Disposable-email blocking.
 *  - Duplicate email / company / phone rejection (409).
 *  - Trial subscription is created against the Start plan (code='start'),
 *    with trial_days=14. If the Start plan is missing the registration still
 *    succeeds and logs a warning (no auto-seeding of a phantom 'trial' plan).
 *  - New user is stored with a scrypt-hashed password and a verification token.
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
// Disable the CAPTCHA gate for these tests so we can exercise the rest of the
// registration flow; CAPTCHA-mandatory behavior is covered in auth-hardening.test.ts.
process.env.CAPTCHA_ENABLED = 'false';
delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

import { mockClient, resetMock, setResult, setResults, findOp } from './helpers/supabase-mock';

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => mockClient,
}));

jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn(async () => true),
  sendPasswordResetEmail: jest.fn(async () => false),
}));

jest.mock('@/lib/default-accounts', () => ({
  createDefaultChartOfAccounts: jest.fn(async () => {}),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true, remainingMinutes: 0 })),
  sanitizeEmailForFilter: (e: string) => e,
  sanitizeIpAddress: (i: string) => i,
}));

import { registerSchema } from '@/lib/validation';
import { POST as registerPOST } from '@/app/api/auth/register/route';

function req(body: any) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as any;
}

const validBody = {
  companyName: 'شركة الأمل للمقاولات',
  name: 'أحمد محمد',
  email: 'ahmed@example.com',
  password: 'Str0ng!Passw0rd',
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

describe('register — user creation security', () => {
  beforeEach(resetMock);

  function successSetup(planRow: any | null = { id: 'p1', code: 'start', trial_days: 14 }) {
    setResult('users', 'select', []); // no duplicate email
    setResult('companies', 'select', []); // no duplicate name/phone
    // The company insert chain ends with `.select(...).single()` → terminal op 'single'.
    setResult('companies', 'single', { id: 'company-1' });
    setResult('users', 'single', { id: 'u1', name: validBody.name, email: validBody.email, role: 'admin' });
    // register now uses maybeSingle (not single) when looking up the Start plan.
    setResult('subscription_plans', 'maybeSingle', planRow);
    setResult('subscriptions', 'upsert', null);
  }

  test('stores a scrypt-hashed password and an email verification token', async () => {
    successSetup();
    const res = await registerPOST(req(validBody));
    expect(res.status).toBe(201);

    const userInsert = findOp('users', 'insert')!;
    const data = userInsert.args[0] as any;
    // scrypt hash format salt:key
    expect(data.password_hash).toContain(':');
    expect(data.password_hash.split(':')[0]).toHaveLength(64); // 32-byte salt
    // verification token present + 24h expiry
    expect(data.email_verification_token).toMatch(/^[0-9a-f]{64}$/);
    const exp = new Date(data.email_verification_expires).getTime();
    expect(exp).toBeGreaterThan(Date.now());
    expect(exp).toBeLessThan(Date.now() + 2 * 24 * 3600 * 1000);
    // must not store plaintext password
    expect(data.password_hash).not.toContain(validBody.password);
    expect(data.role).toBe('admin');
    expect(data.email).toBe(validBody.email.toLowerCase());
  });

  test('creates a trial subscription with the plan trial_days (14 days, Start plan)', async () => {
    successSetup({ id: 'p1', code: 'start', trial_days: 14 });
    const res = await registerPOST(req(validBody));
    expect(res.status).toBe(201);

    const upsert = findOp('subscriptions', 'upsert')!;
    expect(upsert).not.toBeNull();
    const sub = upsert.args[0] as any;
    expect(sub.plan_id).toBe('p1');
    expect(sub.plan_code).toBe('start');
    expect(sub.status).toBe('trial');
    expect(sub.auto_renew).toBe(false);
    // end_date should be today + 14 days
    const end = new Date(sub.end_date);
    const start = new Date(sub.start_date);
    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(14);
  });

  test('RESILIENCE: registration still succeeds when the Start plan row is missing (no auto-seeding)', async () => {
    // The Start plan is missing in the DB (migration 032 hasn't been run yet).
    successSetup(null);

    const res = await registerPOST(req(validBody));
    expect(res.status).toBe(201);

    // Register must NOT try to recreate a 'trial' plan behind the scenes.
    const planInsert = findOp('subscription_plans', 'insert');
    expect(planInsert).toBeNull();

    // It skips creating the subscription (warns) rather than failing.
    const upsert = findOp('subscriptions', 'upsert');
    expect(upsert).toBeNull();
  });
});
