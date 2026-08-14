import { createHmac, timingSafeEqual } from 'crypto';

const PORTAL_TOKEN_TTL_SECONDS = 15 * 60;

export interface PortalTokenPayload {
  contactId: string;
  companyId: string;
  email: string;
  iat: number;
  exp: number;
}

function getPortalSecret(): string {
  const secret = (process.env.PORTAL_SECRET || '').trim();
  if (secret.length < 32) {
    throw new Error('PORTAL_SECRET must be set to a random value of at least 32 characters');
  }
  return secret;
}

function sameSignature(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/** Creates a one-time-delivery, short-lived magic-link credential for a contact. */
export function createPortalToken(contact: Pick<PortalTokenPayload, 'contactId' | 'companyId' | 'email'>): string {
  if (!contact.contactId || !contact.companyId || !contact.email) {
    throw new Error('Portal contact context is incomplete');
  }
  const now = Math.floor(Date.now() / 1000);
  const encodedPayload = Buffer.from(JSON.stringify({
    contactId: contact.contactId,
    companyId: contact.companyId,
    email: contact.email.toLowerCase(),
    iat: now,
    exp: now + PORTAL_TOKEN_TTL_SECONDS,
  })).toString('base64url');
  const signature = createHmac('sha256', getPortalSecret()).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

/** Verifies the exact token format and claims before any database query. */
export function verifyPortalToken(token: string): PortalTokenPayload | null {
  try {
    if (!token || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

    const expectedSignature = createHmac('sha256', getPortalSecret())
      .update(parts[0])
      .digest('base64url');
    if (!sameSignature(parts[1], expectedSignature)) return null;

    const payload: unknown = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const p = payload as Record<string, unknown>;
    if (
      typeof p.contactId !== 'string' || !p.contactId ||
      typeof p.companyId !== 'string' || !p.companyId ||
      typeof p.email !== 'string' || !p.email ||
      typeof p.iat !== 'number' || !Number.isInteger(p.iat) ||
      typeof p.exp !== 'number' || !Number.isInteger(p.exp)
    ) return null;

    const now = Math.floor(Date.now() / 1000);
    // Do not accept a token issued too far into the future or with an arbitrary TTL.
    if (p.iat > now + 60 || p.exp <= now || p.exp - p.iat > PORTAL_TOKEN_TTL_SECONDS) return null;
    return { contactId: p.contactId, companyId: p.companyId, email: p.email.toLowerCase(), iat: p.iat, exp: p.exp };
  } catch {
    return null;
  }
}

export const portalTokenTtlSeconds = PORTAL_TOKEN_TTL_SECONDS;
