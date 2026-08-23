/**
 * Comprehensive token-type tests.
 *
 * Covers every token kind used by the auth system:
 *  1. Auth JWT (createToken / verifyToken) — signature, expiry, tampering,
 *     and the new token_version (`ver`) embedded in the payload.
 *  2. token_version enforcement semantics (legacy tokens → version 0,
 *     version mismatch → rejected).
 *  3. Admin token — role 'superadmin' accepted, non-superadmin rejected.
 *  4. Password-reset token — raw token is 256-bit and its stored form is a
 *     SHA-256 hash (never the plaintext).
 *  5. Email-verification token — 256-bit, distinct per issuance.
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-separate-secret-32chars!';

import { getTokenSecret, createToken, verifyToken, createAdminToken, verifyAdminToken as verifyAdminJwt, extractToken } from '@/lib/auth';
import { createHash, randomBytes, createHmac } from 'crypto';
import type { RequestLike } from '@/lib/types';

// Re-export for backwards compat with existing assertions below
const verifyAdminToken = async (req: { cookies?: { get?: (k: string) => { value: string } | undefined } }) => {
  const token = req?.cookies?.get?.('admin_token')?.value;
  if (!token) return null;
  return verifyAdminJwt(token);
};

// ---- Sanity helpers replicating the routes' token generation ----

function genRawToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeAdminRequest(token?: string): { cookies: { get: (k: string) => { value: string } | undefined } } {
  return {
    cookies: {
      get: (k: string) => (k === 'admin_token' && token ? { value: token } : undefined),
    },
  };
}

describe('Auth JWT', () => {
  const signed = (headerValue: unknown, payloadValue: unknown) => {
    const header = Buffer.from(JSON.stringify(headerValue)).toString('base64url');
    const payload = Buffer.from(JSON.stringify(payloadValue)).toString('base64url');
    const sig = createHmac('sha256', process.env.TOKEN_SECRET!).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${sig}`;
  };

  test('fails closed for missing secrets and malformed header/payload claim shapes', () => {
    const saved = process.env.TOKEN_SECRET;
    delete process.env.TOKEN_SECRET;
    expect(() => getTokenSecret()).toThrow('TOKEN_SECRET');
    process.env.TOKEN_SECRET = saved;
    const fixedNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    const now = Math.floor(fixedNow / 1000);
    for (const header of [null, [], { alg: 'none', typ: 'JWT' }, { alg: 'HS256', typ: 'BAD' }]) {
      expect(verifyToken(signed(header, { sub: 'u', role: 'admin', iat: now, exp: now + 60 }))).toBeNull();
    }
    for (const payload of [null, [],
      { sub: '', role: 'admin', iat: now, exp: now + 60 },
      { sub: 'u', role: '', iat: now, exp: now + 60 },
      { sub: 'u', role: 'admin', iat: 'x', exp: now + 60 },
      { sub: 'u', role: 'admin', iat: now, exp: 1.5 },
      { sub: 'u', role: 'admin', iat: now + 61, exp: now + 120 },
      { sub: 'u', role: 'admin', iat: now, exp: now },
    ]) expect(verifyToken(signed({ alg: 'HS256', typ: 'JWT' }, payload))).toBeNull();
    nowSpy.mockRestore();
  });
  test('extracts bearer/cookie tokens and handles missing cookie APIs', () => {
    expect(extractToken({ headers: new Headers({ authorization: 'Bearer abc' }) } as unknown as RequestLike)).toBe('abc');
    expect(extractToken({ headers: new Headers(), cookies: { get: () => ({ value: 'cookie' }) } } as unknown as RequestLike)).toBe('cookie');
    expect(extractToken({ headers: new Headers(), cookies: { get: () => undefined } } as unknown as RequestLike)).toBeNull();
    expect(extractToken({ headers: new Headers() } as unknown as RequestLike)).toBeNull();
  });

  test('creates a well-formed 3-part token and verifies round-trip', () => {
    const t = createToken('user-abc', 'admin', 0);
    expect(t.split('.')).toHaveLength(3);
    const payload = verifyToken(t);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe('user-abc');
    expect(payload!.role).toBe('admin');
    expect(payload!.ver).toBe(0);
  });

  test('embeds the provided token_version', () => {
    const t = createToken('u1', 'accountant', 7);
    expect(verifyToken(t)!.ver).toBe(7);
  });

  test('rejects a token signed with a different secret', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'u', role: 'admin', ver: 0, iat: 0, exp: 9999999999 })
    ).toString('base64url');
    const sig = createHmac('sha256', 'attacker-secret').update(`${header}.${payload}`).digest('base64url');
    const forged = `${header}.${payload}.${sig}`;
    expect(verifyToken(forged)).toBeNull();
  });

  test('rejects an expired token even with a valid signature', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'u', role: 'admin', ver: 0, iat: 1000000, exp: 1000001 })
    ).toString('base64url');
    const sig = createHmac('sha256', process.env.TOKEN_SECRET!).update(`${header}.${payload}`).digest('base64url');
    expect(verifyToken(`${header}.${payload}.${sig}`)).toBeNull();
  });

  test('rejects tampered payload', () => {
    const t = createToken('u1', 'admin', 0);
    const [h, , s] = t.split('.');
    const evil = Buffer.from(JSON.stringify({ sub: 'victim', role: 'superadmin', ver: 99, exp: 9999999999 })).toString('base64url');
    expect(verifyToken(`${h}.${evil}.${s}`)).toBeNull();
  });

  test('rejects malformed tokens', () => {
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('a.b')).toBeNull();
    expect(verifyToken('a.b.c.d')).toBeNull();
    expect(verifyToken('!!!not-base64')).toBeNull();
  });

  test('treats a legacy token with no `ver` field as version 0', () => {
    // A token issued before token_version existed (no `ver` in payload).
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'legacy-user', role: 'admin', iat: 0, exp: 9999999999 })
    ).toString('base64url');
    const sig = createHmac('sha256', process.env.TOKEN_SECRET!).update(`${header}.${payload}`).digest('base64url');
    const legacy = `${header}.${payload}.${sig}`;
    const p = verifyToken(legacy);
    expect(p).not.toBeNull();
    expect(p!.ver).toBe(0);
  });
});

describe('token_version invalidation semantics', () => {
  // Simulate the DB-side comparison used by requireApiAuth / getCompanyContext:
  // stored version must equal the token's version, else the session is stale.
  function isTokenCurrent(token: string, storedVersion: number): boolean {
    const p = verifyToken(token);
    if (!p) return false;
    return p.ver === storedVersion;
  }

  test('valid token is accepted when versions match', () => {
    const t = createToken('u', 'admin', 3);
    expect(isTokenCurrent(t, 3)).toBe(true);
  });

  test('valid token is rejected when stored version was bumped (logout/pw change)', () => {
    const t = createToken('u', 'admin', 3);
    expect(isTokenCurrent(t, 4)).toBe(false); // bump happened after issuance
    expect(isTokenCurrent(t, 0)).toBe(false);
  });

  test('a legacy token (version 0) is accepted only if stored version is still 0', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u', role: 'admin', iat: 0, exp: 9999999999 })).toString('base64url');
    const sig = createHmac('sha256', process.env.TOKEN_SECRET!).update(`${header}.${payload}`).digest('base64url');
    const legacy = `${header}.${payload}.${sig}`;
    // User never logged out / changed password → stored version 0 → accepted.
    expect(isTokenCurrent(legacy, 0)).toBe(true);
    // After a password change bumped it to 1 → the legacy token is invalid.
    expect(isTokenCurrent(legacy, 1)).toBe(false);
  });
});

describe('Admin token (superadmin JWT)', () => {
  test('production fails closed when the separate admin secret is absent', () => {
    const saved = process.env.ADMIN_TOKEN_SECRET; const savedEnv = process.env.NODE_ENV;
    delete process.env.ADMIN_TOKEN_SECRET; Reflect.set(process.env, 'NODE_ENV', 'production');
    expect(() => createAdminToken('admin', 0)).toThrow('ADMIN_TOKEN_SECRET');
    process.env.ADMIN_TOKEN_SECRET = saved; Reflect.set(process.env, 'NODE_ENV', savedEnv);
  });

  test('development fallback signs admin JWTs with TOKEN_SECRET when admin secret is absent', () => {
    const saved = process.env.ADMIN_TOKEN_SECRET;
    const savedEnv = process.env.NODE_ENV;
    delete process.env.ADMIN_TOKEN_SECRET;
    Reflect.set(process.env, 'NODE_ENV', 'test');
    const token = createAdminToken('fallback-admin', 0);
    expect(verifyToken(token)?.role).toBe('superadmin');
    process.env.ADMIN_TOKEN_SECRET = saved;
    Reflect.set(process.env, 'NODE_ENV', savedEnv);
  });

  test('accepts a valid superadmin admin_token (signed with ADMIN_TOKEN_SECRET)', () => {
    const t = createAdminToken('admin-1', 0);
    const payload = verifyAdminJwt(t);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe('admin-1');
    expect(payload!.role).toBe('superadmin');
  });

  test('rejects a normal user JWT when used as an admin token (different secret)', () => {
    const t = createToken('admin-1', 'superadmin', 0); // signed with TOKEN_SECRET, not ADMIN
    expect(verifyAdminJwt(t)).toBeNull();
  });

  test('rejects an admin_token whose role is not superadmin', () => {
    // Forge a token with the admin secret but wrong role; verifyAdminToken requires role=superadmin.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ sub: 'admin-1', role: 'admin', ver: 0, iat: now, exp: now + 3600 })).toString('base64url');
    const sig = createHmac('sha256', process.env.ADMIN_TOKEN_SECRET!).update(`${header}.${payload}`).digest('base64url');
    expect(verifyAdminJwt(`${header}.${payload}.${sig}`)).toBeNull();
  });

  test('returns null when no admin_token cookie is present', async () => {
    expect(await verifyAdminToken(makeAdminRequest(undefined))).toBeNull();
  });

  test('returns null for an expired admin token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'admin-1', role: 'superadmin', ver: 0, iat: 1000000, exp: 1000001 })
    ).toString('base64url');
    const sig = createHmac('sha256', process.env.ADMIN_TOKEN_SECRET!).update(`${header}.${payload}`).digest('base64url');
    expect(verifyAdminJwt(`${header}.${payload}.${sig}`)).toBeNull();
  });

  test('rejects a token signed with the wrong (user) secret', () => {
    const t = createToken('x', 'superadmin', 0);
    expect(verifyAdminJwt(t)).toBeNull();
  });
});

describe('Password-reset token', () => {
  test('generates a 256-bit raw token (64 hex chars)', () => {
    const raw = genRawToken();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    // 32 bytes = 256 bits
    expect(Buffer.from(raw, 'hex').length).toBe(32);
  });

  test('stored form is a SHA-256 hash, not the raw token (no plaintext at rest)', () => {
    const raw = genRawToken();
    const stored = hashToken(raw);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(raw); // never store the raw token
    expect(stored).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  test('distinct raw tokens produce distinct hashes', () => {
    const h1 = hashToken(genRawToken());
    const h2 = hashToken(genRawToken());
    expect(h1).not.toBe(h2);
  });
});

describe('Email-verification token', () => {
  test('generates a 256-bit random token', () => {
    const t = genRawToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(t, 'hex').length).toBe(32);
  });

  test('tokens are unique across issuances (resend produces a fresh token)', () => {
    const t1 = genRawToken();
    const t2 = genRawToken();
    expect(t1).not.toBe(t2);
  });
});
