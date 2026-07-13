import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto';

function cleanEnv(s: string): string {
  return (s || '').replace(/^\uFEFF/, '').trim();
}

const rawSecret = process.env.TOKEN_SECRET;
if (!rawSecret) {
  throw new Error('TOKEN_SECRET environment variable is required');
}
const TOKEN_SECRET = cleanEnv(rawSecret);
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

export function createToken(userId: string, role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      role,
      iat: now,
      exp: now + 86400 * 7,
    })
  ).toString('base64url');
  const signature = createHmac('sha256', TOKEN_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token: string): { userId: string; role: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;

    const expectedSig = createHmac('sha256', TOKEN_SECRET)
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

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;

    return { userId: data.sub, role: data.role };
  } catch {
    return null;
  }
}

export async function getCompanyContext(
  request: Request
): Promise<{ companyId: string; userId: string; role: string } | null> {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const token = bearerToken || (request as any).cookies?.get?.('token')?.value || '';

    if (!token) return null;

    const payload = verifyToken(token);
    if (!payload) return null;

    const { query } = await import('@/lib/db');
    const res = await query('SELECT company_id FROM users WHERE id = $1', [payload.userId]);
    if (res.rows.length === 0) return null;

    return {
      companyId: res.rows[0].company_id,
      userId: payload.userId,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);

  // Also check cookie
  const cookie = (request as any).cookies?.get?.('token')?.value;
  if (cookie) return cookie;

  return null;
}
