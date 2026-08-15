/**
 * Route-level tests for email verification:
 *   /api/auth/verify-email  and  /api/auth/resend-verification
 *
 * Covers:
 *  - verify-email: valid token marks the user verified & clears the token;
 *    missing/expired tokens are rejected.
 *  - resend-verification: issues a fresh 256-bit token, stores a new expiry,
 *    only for unverified active users; generic anti-enumeration for missing
 *    users; refuses already-verified addresses; rate-limited.
 */

import { mockClient, resetMock, setResult, findOp, getCalls, callsForTable } from './helpers/supabase-mock';
import { createHash } from 'crypto';

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => mockClient,
}));

jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn(async () => true),
  sendPasswordResetEmail: jest.fn(async () => false),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true, remainingMinutes: 0 })),
  sanitizeEmailForFilter: (e: string) => e,
  sanitizeIpAddress: (i: string) => i,
}));

import { POST as verifyPOST } from '@/app/api/auth/verify-email/route';
import { POST as resendPOST } from '@/app/api/auth/resend-verification/route';

function req(body: any) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as any;
}

describe('verify-email', () => {
  beforeEach(resetMock);

  test('requires a token', async () => {
    const res = await verifyPOST(req({}));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.message).toContain('رمز التحقق مطلوب');
  });

  test('marks the user verified and clears the token fields', async () => {
    setResult('users', 'maybeSingle', { id: 'u1', email: 'a@b.com' });
    setResult('users', 'update', null);

    const res = await verifyPOST(req({ token: 'a'.repeat(64) }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.message).toContain('تم تأكيد البريد');

    const update = findOp('users', 'update')!;
    const data = update.args[0] as any;
    expect(data.email_verified).toBe(true);
    expect(data.email_verification_token).toBeNull();
    expect(data.email_verification_expires).toBeNull();
  });

  test('looks up only the SHA-256 digest of the URL token', async () => {
    const raw = 'b'.repeat(64);
    setResult('users', 'maybeSingle', null);
    await verifyPOST(req({ token: raw }));
    const lookup = callsForTable('users')[0].ops.find((op) => op.op === 'eq' && op.args[0] === 'email_verification_token');
    expect(lookup?.args[1]).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(lookup?.args[1]).not.toBe(raw);
  });

  test('rejects an invalid or expired token', async () => {
    setResult('users', 'maybeSingle', null); // no user matches the token/expiry
    const res = await verifyPOST(req({ token: 'bad-or-expired' }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.message).toContain('غير صالح أو منتهي');
  });

  test('does not update the user when the token is invalid', async () => {
    setResult('users', 'maybeSingle', null);
    await verifyPOST(req({ token: 'bad' }));
    expect(findOp('users', 'update')).toBeNull();
  });
});

describe('resend-verification', () => {
  beforeEach(resetMock);

  test('sends a fresh token for an unverified active user', async () => {
    setResult('users', 'maybeSingle', { id: 'u1', name: 'A', email_verified: false, is_active: true });
    setResult('users', 'update', null);

    const res = await resendPOST(req({ email: 'user@example.com' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.message).toContain('إرسال رابط التأكيد');

    const update = findOp('users', 'update')!;
    const data = update.args[0] as any;
    // Fresh 256-bit token (64 hex) + 24h expiry
    expect(data.email_verification_token).toMatch(/^[0-9a-f]{64}$/);
    const exp = new Date(data.email_verification_expires).getTime();
    expect(exp).toBeGreaterThan(Date.now());
    expect(exp).toBeLessThan(Date.now() + 2 * 24 * 3600 * 1000);
  });

  test('does NOT resend for an already-verified email', async () => {
    setResult('users', 'maybeSingle', { id: 'u1', email_verified: true, is_active: true });
    const res = await resendPOST(req({ email: 'verified@example.com' }));
    const j = await res.json();
    expect(j.data.message).toContain('تم تأكيد هذا البريد الإلكتروني مسبقاً');
    expect(findOp('users', 'update')).toBeNull();
  });

  test('returns a generic message for a non-existent/inactive user (anti-enumeration)', async () => {
    setResult('users', 'maybeSingle', null);
    const res = await resendPOST(req({ email: 'ghost@example.com' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.message).toContain('إذا كان البريد الإلكتروني مسجلاً');
    expect(j.resetUrl).toBeUndefined();
  });

  test('rejects an invalid email via schema', async () => {
    const res = await resendPOST(req({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  test('only performs a single users lookup then one update', async () => {
    setResult('users', 'maybeSingle', { id: 'u1', email_verified: false, is_active: true });
    setResult('users', 'update', null);
    await resendPOST(req({ email: 'user@example.com' }));
    const userOps = callsForTable('users');
    expect(userOps.length).toBe(2); // 1 lookup + 1 update
  });
});
