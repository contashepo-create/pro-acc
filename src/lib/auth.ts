import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto';

function cleanEnv(s: string): string {
  return (s || '').replace(/^\uFEFF/, '').trim();
}

// Lazy evaluation: check TOKEN_SECRET at usage time, not import time.
// This allows the module to be imported during Next.js build even without env vars.
export function getTokenSecret(): string {
  const secret = cleanEnv(process.env.TOKEN_SECRET || '');
  // HMAC keys shorter than 256 bits undermine the security of every session.
  // Fail closed instead of silently accepting an accidental placeholder.
  if (secret.length < 32) {
    throw new Error('TOKEN_SECRET must be set to a random value of at least 32 characters');
  }
  return secret;
}

/**
 * ADMIN_TOKEN_SECRET must be DIFFERENT from TOKEN_SECRET so that user JWTs can
 * never authenticate against /api/admin/* endpoints, even if leaked/forged.
 * In production, fail-closed when missing; in dev allow fallback with warning.
 */
function getAdminTokenSecret(): string {
  const raw = process.env.ADMIN_TOKEN_SECRET;
  if (!raw || !cleanEnv(raw)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ADMIN_TOKEN_SECRET must be set in production (different from TOKEN_SECRET)');
    }
    console.warn(
      '⚠️ SECURITY: ADMIN_TOKEN_SECRET not set; falling back to TOKEN_SECRET for admin JWTs. ' +
      'Set a distinct ADMIN_TOKEN_SECRET before deploying.'
    );
    return getTokenSecret();
  }
  return cleanEnv(raw);
}

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32).toString('hex');
  const derivedKey = scryptSync(password, salt, KEY_LENGTH) as Buffer;
  return salt + ':' + derivedKey.toString('hex');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  const derivedKey = scryptSync(password, salt, KEY_LENGTH) as Buffer;
  const keyBuffer = Buffer.from(key, 'hex');
  if (derivedKey.length !== keyBuffer.length) return false;
  try {
    return timingSafeEqual(derivedKey, keyBuffer);
  } catch {
    return false;
  }
}

function signJwt(userId: string, role: string, version: number, secret: string, ttlSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      role,
      ver: version,
      iat: now,
      exp: now + ttlSeconds,
    })
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyJwt(token: string, secret: string, requiredRole?: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const decodedHeader: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (!decodedHeader || typeof decodedHeader !== 'object' || Array.isArray(decodedHeader)) return null;
    const jwtHeader = decodedHeader as Record<string, unknown>;
    // Explicitly bind verification to the one algorithm this implementation
    // supports. Never accept an algorithm claim merely because an HMAC matches.
    if (jwtHeader.alg !== 'HS256' || jwtHeader.typ !== 'JWT') return null;

    const expectedSig = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigBuffer = Buffer.from(signature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSig, 'base64url');
    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return null;
    }

    const decodedPayload: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decodedPayload || typeof decodedPayload !== 'object' || Array.isArray(decodedPayload)) return null;
    const data = decodedPayload as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    // A signed token without an expiry is still unsafe after a secret leak or
    // user deactivation. Reject malformed/legacy unbounded claims outright.
    if (
      typeof data.sub !== 'string' || !data.sub ||
      typeof data.role !== 'string' || !data.role ||
      typeof data.iat !== 'number' || !Number.isInteger(data.iat) ||
      typeof data.exp !== 'number' || !Number.isInteger(data.exp) ||
      data.exp <= now || data.iat > now + 60 || data.exp <= data.iat
    ) return null;
    if (requiredRole && data.role !== requiredRole) return null;

    return { userId: data.sub, role: data.role, ver: typeof data.ver === 'number' && Number.isInteger(data.ver) && data.ver >= 0 ? data.ver : 0 };
  } catch {
    return null;
  }
}

/** User-scoped JWT (signed with TOKEN_SECRET). Default TTL 7 days. */
export function createToken(userId: string, role: string, version: number = 0): string {
  return signJwt(userId, role, version, getTokenSecret(), 86400 * 7);
}

/** Admin (superadmin) JWT: signed with ADMIN_TOKEN_SECRET, shorter TTL (24h), role enforced. */
export function createAdminToken(userId: string, version: number = 0): string {
  return signJwt(userId, 'superadmin', version, getAdminTokenSecret(), 86400);
}

export interface TokenPayload {
  userId: string;
  role: string;
  ver: number;
}

export function verifyToken(token: string): TokenPayload | null {
  return verifyJwt(token, getTokenSecret());
}

/**
 * Verify an admin JWT (signed with ADMIN_TOKEN_SECRET, role === 'superadmin').
 * Cross-checking admin_users.is_active MUST be performed by the caller.
 */
export function verifyAdminToken(token: string): TokenPayload | null {
  return verifyJwt(token, getAdminTokenSecret(), 'superadmin');
}

export async function getCompanyContext(
  request: Request
): Promise<{ companyId: string; userId: string; role: string } | null> {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const token = bearerToken || (request as Record<string, any>).cookies?.get?.('token')?.value || '';

    if (!token) return null;

    const payload = verifyToken(token);
    if (!payload) return null;

    const { query } = await import('@/lib/db');
    const res = await query(
      `SELECT u.company_id, u.token_version, u.role
         FROM users u
         JOIN companies c ON c.id = u.company_id
        WHERE u.id = $1 AND u.is_active = TRUE AND c.is_active = TRUE`,
      [payload.userId]
    );
    if (res.rows.length === 0) return null;

    // Reject stale tokens after logout/password changes. The database role is
    // authoritative as roles can be downgraded while a JWT remains valid.
    const storedVersion = Number(res.rows[0].token_version) || 0;
    if (payload.ver !== storedVersion) return null;

    return {
      companyId: res.rows[0].company_id,
      userId: payload.userId,
      role: res.rows[0].role,
    };
  } catch {
    return null;
  }
}

export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);

  // Also check cookie
  const cookie = (request as Record<string, any>).cookies?.get?.('token')?.value;
  if (cookie) return cookie;

  return null;
}
