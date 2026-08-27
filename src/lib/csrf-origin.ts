/**
 * CSRF protection via standard-header (Origin/Referer) verification.
 *
 * Strategy (OWASP "Verifying Origin With Standard Headers"):
 *  - Safe methods (GET/HEAD/OPTIONS) are always allowed.
 *  - For state-changing methods, if an Origin header is present it MUST match
 *    the request host. Browsers always attach Origin to cross-site POST
 *    requests and it cannot be forged or stripped from a browser context,
 *    so a mismatch is a reliable CSRF signal.
 *  - If Origin is absent, fall back to Referer (older browsers).
 *  - If neither header is present the request cannot originate from a
 *    browser form/fetch (curl, server-to-server webhooks, tests) and is
 *    therefore not CSRF-able — it is allowed.
 *
 * This layers on top of `sameSite: 'lax'` auth cookies (first layer) and the
 * optional double-submit token in api-helpers (`checkCsrf`) for
 * defense-in-depth.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths exempt from CSRF checks: server-to-server callbacks that never carry browser cookies. */
export const CSRF_EXEMPT_PATHS: readonly string[] = [
  '/api/telegram/webhook',
  '/api/telegram/callback',
];

export function isCsrfExemptPath(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export interface CsrfCheckInput {
  method?: string | null;
  pathname: string;
  /** Origin request header (may be null or the literal string "null"). */
  origin: string | null;
  /** Referer request header. */
  referer: string | null;
  /** Effective public host of this deployment (x-forwarded-host || host). */
  requestHost?: string | null;
}

/**
 * Returns true when the request passes origin-based CSRF validation.
 */
export function passesOriginCheck(input: CsrfCheckInput): boolean {
  const method = (input.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return true;
  if (isCsrfExemptPath(input.pathname)) return true;

  const requestHost = (input.requestHost || '').toLowerCase();
  // Without a known host we cannot compare — fail closed only when a
  // cross-origin signal exists, otherwise allow.
  const originHeader = input.origin;

  if (originHeader) {
    // "null" origin (sandboxed iframe, data: URL, some redirects) is never
    // a legitimate first-party request.
    if (originHeader === 'null') return false;
    const originHost = hostOf(originHeader);
    if (!originHost) return false;
    return !!requestHost && originHost === requestHost;
  }

  const refererHost = hostOf(input.referer);
  if (refererHost) {
    return !!requestHost && refererHost === requestHost;
  }

  // No Origin and no Referer → not a browser-originated credentialed request.
  return true;
}
