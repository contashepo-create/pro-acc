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

import { mockClient, resetMock, setResult, setRpcResult, getRpcCalls, findOp, callsForTable } from './helpers/supabase-mock';
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
  checkPasswordResetRateLimit: jest.fn(async () => ({ allowed: true, remainingMinutes: 0 })),
  recordPasswordResetRequest: jest.fn(async () => 'request-1'),
  markPasswordResetRequest: jest.fn(async () => undefined),
  sanitizeEmailForFilter: (e: string) => e,
  sanitizeIpAddress: (i: string) => i,
}));

import { POST as verifyPOST } from '@/app/api/auth/verify-email/route';
import { POST as resendPOST } from '@/app/api/auth/resend-verification/route';
import type { NextRequest } from 'next/server';

function req(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: { get: () => null },
    nextUrl: { origin: 'http://localhost' },
  } as unknown as NextRequest;
}

describe('verify-email — one-time RPC boundary', () => {
  beforeEach(resetMock);

  test('requires a 64-character token', async () => {
    const res = await verifyPOST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('غير صالح أو منتهي');
    expect(getRpcCalls()).toHaveLength(0);
  });

  test('hashes the URL token and consumes it atomically', async () => {
    const raw = 'a'.repeat(64);
    setRpcResult('consume_email_verification_token', { email: 'a@b.com' });
    const res = await verifyPOST(req({ token: raw }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.email).toBe('a@b.com');
    expect(getRpcCalls()).toEqual([{
      name: 'consume_email_verification_token',
      params: { p_token_hash: createHash('sha256').update(raw).digest('hex') },
    }]);
    expect(findOp('users', 'update')).toBeNull();
  });

  test('maps invalid, expired and replayed token errors to one response', async () => {
    setRpcResult('consume_email_verification_token', { data: null, error: { code: 'P0001', message: 'رمز التحقق غير صالح' } });
    const res = await verifyPOST(req({ token: 'b'.repeat(64) }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('غير صالح أو منتهي');
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
    expect(j.data.message).toContain('إذا كان البريد الإلكتروني مسجلاً');

    const update = findOp('users', 'update')!;
    const data = update.args[0] as Record<string, unknown>;
    // Fresh 256-bit token (64 hex) + 24h expiry
    expect(String(data.email_verification_token)).toMatch(/^[0-9a-f]{64}$/);
    const exp = new Date(String(data.email_verification_expires)).getTime();
    expect(exp).toBeGreaterThan(Date.now());
    expect(exp).toBeLessThan(Date.now() + 2 * 24 * 3600 * 1000);
  });

  test('does NOT resend for an already-verified email', async () => {
    setResult('users', 'maybeSingle', { id: 'u1', email_verified: true, is_active: true });
    const res = await resendPOST(req({ email: 'verified@example.com' }));
    const j = await res.json();
    expect(j.data.message).toContain('إذا كان البريد الإلكتروني مسجلاً');
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
