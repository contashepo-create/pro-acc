import { NextRequest, NextResponse } from 'next/server';
import { passesOriginCheck } from '@/lib/csrf-origin';
import { verifyToken, verifyAdminToken, type TokenPayload } from '@/lib/auth';

/**
 * Server-level request gate (Next.js 16 "proxy", formerly middleware).
 *
 * 1. CSRF: state-changing /api requests must pass a standard-header
 *    (Origin/Referer) check. This closes the gap where `requireCsrf` was
 *    defined but never wired into any handler, and it protects all 220+
 *    routes centrally instead of relying on per-handler discipline.
 *
 * 2. AuthN for pages: dashboard pages and the zerocold admin panel redirect
 *    unauthenticated visitors to the proper login page BEFORE any HTML is
 *    served (no more client-only guard / flash of protected content).
 *    Full authorization (role, token_version, subscription) remains in the
 *    API handlers via requireApiAuth — this layer only verifies the JWT
 *    signature and expiry.
 */

/** Page prefixes that never require a session. */
const PUBLIC_PAGE_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/setup',
  '/portal', // customer portal has its own auth flow
];

/** zerocold pages reachable without an admin session (the login chain). */
const PUBLIC_ADMIN_PAGE_PREFIXES = [
  '/zerocold/login',
  '/zerocold/verify-master',
  '/zerocold/verify-telegram',
];

/**
 * Pages restricted to company admins only. Mirrors the Sidebar filter —
 * previously this was ONLY a UI filter, so any additional user could open
 * /settings etc. directly (e.g. from the header dropdown or by typing the
 * URL). Now enforced server-side before any HTML is served.
 * NOTE: the JWT role is signed so it cannot be forged; the API layer still
 * re-checks the authoritative DB role on every request.
 * /subscription is deliberately NOT here: it is the renewal/billing surface
 * that EVERY company user must reach when the subscription expires (see the
 * dashboard layout redirect + subscription-guard).
 */
const ADMIN_ONLY_PAGE_PREFIXES = [
  '/settings',
  '/permissions',
  '/users',
  '/fiscal',
];

function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function safeVerifyUserToken(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    // Missing TOKEN_SECRET or malformed env — treat as unauthenticated;
    // the login flow surfaces the real configuration error.
    return null;
  }
}

function safeVerifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  try {
    return verifyAdminToken(token) !== null;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ---------- 1) CSRF gate for API routes ----------
  if (pathname.startsWith('/api')) {
    const requestHost =
      request.headers.get('x-forwarded-host') || request.headers.get('host');
    const ok = passesOriginCheck({
      method: request.method,
      pathname,
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
      requestHost,
    });
    if (!ok) {
      return NextResponse.json(
        { success: false, message: 'فشل التحقق من مصدر الطلب (CSRF)' },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  // ---------- 2) Server-side auth for pages ----------

  // zerocold admin panel
  if (pathname === '/zerocold' || pathname.startsWith('/zerocold/')) {
    if (startsWithAny(pathname, PUBLIC_ADMIN_PAGE_PREFIXES)) {
      return NextResponse.next();
    }
    const adminToken = request.cookies.get('admin_token')?.value;
    if (!safeVerifyAdminToken(adminToken)) {
      const url = request.nextUrl.clone();
      url.pathname = '/zerocold/login';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Landing page is public
  if (pathname === '/') return NextResponse.next();

  // Auth pages and the customer portal are public
  if (startsWithAny(pathname, PUBLIC_PAGE_PREFIXES)) {
    return NextResponse.next();
  }

  // Everything else under the (dashboard) group requires a valid user JWT.
  const token = request.cookies.get('token')?.value;
  const payload = safeVerifyUserToken(token);
  if (!payload) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `redirect=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // RBAC page gate: admin-only pages (settings, users, permissions,
  // subscription, fiscal) bounce non-admin users back to the dashboard.
  // Fixes the bypass where the header dropdown (or a typed URL) opened
  // /settings for sub-users even though the sidebar hid it.
  if (payload.role !== 'admin' && startsWithAny(pathname, ADMIN_ONLY_PAGE_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = 'denied=admin-only';
    return NextResponse.redirect(url);
  }

  // Authenticated HTML must never be cached: prevents the browser
  // back-button (or bfcache/disk cache) from showing tenant data after
  // logout, and stale pages after switching accounts.
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)',
  ],
};
