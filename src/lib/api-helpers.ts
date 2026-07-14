import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

export function success<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export function unauthorized() {
  return error('Unauthorized', 401);
}

export function notFound() {
  return error('Not found', 404);
}

export function validationError(errors: Record<string, string[]> | string) {
  return NextResponse.json({ success: false, message: 'Validation failed', errors }, { status: 422 });
}

export function serverError(err: unknown) {
  console.error('Server error:', err);
  const message = process.env.NODE_ENV !== 'production'
    ? (err instanceof Error ? err.message : 'Internal server error')
    : 'حدث خطأ في الخادم';
  return NextResponse.json({ success: false, message }, { status: 500 });
}

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthError'; }
}

const sb = () => getSupabase();

export async function requireApiAuth(request: Request, options: { checkSubscription?: boolean } = {}): Promise<{ companyId: string; userId: string; role: string }> {
  const { extractToken, verifyToken } = await import('@/lib/auth');
  const token = extractToken(request);
  if (!token) throw new AuthError('غير مصرح به');

  const payload = verifyToken(token);
  if (!payload) throw new AuthError('غير مصرح به');

  const s = sb();
  // SECURITY FIX: Fetch role from database (source of truth) instead of JWT token.
  // The JWT role could be stale or manipulated. The DB role is authoritative.
  const { data: user, error: userErr } = await s.from('users')
    .select('company_id, is_active, role')
    .eq('id', payload.userId)
    .single();

  if (userErr || !user) throw new AuthError('المستخدم غير موجود');
  const u = user;
  if (!u.is_active) throw new AuthError('المستخدم غير نشط');

  // Check company is active
  try {
    const { data: company } = await s.from('companies').select('is_active').eq('id', u.company_id).single();
    if (company && (company as Record<string, any>).is_active === false) {
      throw new AuthError('الشركة غير نشطة. تواصل مع مدير النظام');
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    // ignore if company check fails
  }

  // Check subscription if requested
  if (options.checkSubscription) {
    try {
      const { getCompanySubscription } = await import('@/lib/subscription');
      const sub = await getCompanySubscription(u.company_id);
      if (sub && sub.is_expired) {
        throw new AuthError('انتهت صلاحية الاشتراك. يرجى تجديد الاشتراك');
      }
    } catch (e) {
      if (e instanceof AuthError) throw e;
      // ignore subscription check errors (fail open for now, log)
      console.warn('Subscription check failed:', e);
    }
  }

  return { companyId: u.company_id, userId: payload.userId, role: u.role };
}

export async function requireApiAuthWithSubscription(request: Request) {
  return requireApiAuth(request, { checkSubscription: true });
}

/**
 * RBAC Role Check - Enforces role-based access control on sensitive operations.
 * Role hierarchy: admin > manager > accountant > supervisor
 * - admin: Full access to all operations
 * - manager: Can manage most operations except company settings and user management
 * - accountant: Can create/edit financial entries, cannot delete or approve
 * - supervisor: Read-only + limited create (vouchers, receipts)
 *
 * Usage: await requireRole(request, ['admin', 'manager'])
 */
export async function requireRole(
  request: Request,
  allowedRoles: string[]
): Promise<{ companyId: string; userId: string; role: string }> {
  const auth = await requireApiAuth(request);
  if (!allowedRoles.includes(auth.role)) {
    throw new AuthError(
      `ليس لديك صلاحية لتنفيذ هذا الإجراء. الصلاحيات المطلوبة: ${allowedRoles.join(' أو ')}. دورك الحالي: ${auth.role}`
    );
  }
  return auth;
}

/** Shortcut: only admin can perform this action */
export async function requireAdmin(request: Request) {
  return requireRole(request, ['admin']);
}

/** Shortcut: admin or manager can perform this action */
export async function requireManagerOrAbove(request: Request) {
  return requireRole(request, ['admin', 'manager']);
}

/** Shortcut: admin, manager, or accountant can perform this action */
export async function requireAccountantOrAbove(request: Request) {
  return requireRole(request, ['admin', 'manager', 'accountant']);
}

export async function requireAdminAuth(request: Request): Promise<{ userId: string; email: string }> {
  const req = request ;
  const adminToken = req.cookies?.get
    ? req.cookies.get('admin_token')?.value
    : null;

  if (!adminToken) throw new AuthError('غير مصرح به');

  const { verifyToken } = await import('@/lib/auth');
  const payload = verifyToken(adminToken);
  if (!payload || payload.role !== 'superadmin') throw new AuthError('غير مصرح به');

  return { userId: payload.userId, email: payload.userId };
}

export function handleApiError(err: unknown) {
  if (err instanceof AuthError) return error(err.message, 401);
  return serverError(err);
}

export async function parseBody<T = any>(request: Request): Promise<T> {
  return request.json();
}

export function checkCsrf(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  
  // FIXED: CSRF must be enforced in all environments, not just production
  // If you need to bypass for local testing, use CSRF_BYPASS=true env var
  if (process.env.CSRF_BYPASS === 'true') return true;

  const csrfToken = request.headers.get('x-csrf-token');
  const csrfCookie = (request as Record<string, any>).cookies?.get?.('csrf_token')?.value;

  if (!csrfToken || !csrfCookie) return false;
  
  // FIXED: timing-safe comparison to prevent timing attacks
  if (csrfToken.length !== csrfCookie.length) return false;
  let diff = 0;
  for (let i = 0; i < csrfToken.length; i++) {
    diff |= csrfToken.charCodeAt(i) ^ csrfCookie.charCodeAt(i);
  }
  return diff === 0;
}

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m] as string));
}

export function requireCsrf(request: Request): void {
  if (!checkCsrf(request)) {
    throw new AuthError('CSRF validation failed');
  }
}

export function getPaginationParams(url: string | URL): { page: number; pageSize: number } {
  const urlObj = url instanceof URL ? url : new URL(url, 'http://localhost');
  const page = Math.max(1, parseInt(urlObj.searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(urlObj.searchParams.get('pageSize') || '50', 10) || 50));
  return { page, pageSize };
}

export function getDateRangeParams(url: string | URL): { from: string | null; to: string | null } {
  const urlObj = url instanceof URL ? url : new URL(url, 'http://localhost');
  const from = urlObj.searchParams.get('from') || null;
  const to = urlObj.searchParams.get('to') || null;
  return { from, to };
}

// Detect if running on HTTPS (Vercel always is, localhost is not)
const isHttps = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

const cookieDefaults = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: isHttps,
};

export function setAuthCookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, { ...cookieDefaults, maxAge });
}

export function clearAuthCookie(response: NextResponse, name: string) {
  response.cookies.set(name, '', { ...cookieDefaults, maxAge: 0 });
}
