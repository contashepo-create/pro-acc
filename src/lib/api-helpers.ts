import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { applyCacheHeaders, type CacheOptions } from '@/lib/cache';

export function success<T>(data: T, status = 200, cacheOptions?: CacheOptions) {
  const response = NextResponse.json({ success: true, data }, { status });
  // Default no-store: tenant lists (accounts, journals, …) must not linger in
  // the browser/CDN after a delete. Opt in only for truly static payloads.
  applyCacheHeaders(response, cacheOptions ?? { cache: 'no-store' });
  return response;
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
  // NOTE: Supabase/PostgREST errors are NOT Error instances — they are plain
  // objects shaped { message, code, details, hint }. Unwrap every common
  // shape so the ACTUAL error surfaces in the SERVER LOG below.
  let message = '';
  let details: string | undefined;
  if (err instanceof Error && err.message) {
    message = err.message;
  } else if (err && typeof err === 'object') {
    const e = err as Record<string, any>;
    if (typeof e.message === 'string' && e.message) message = e.message;
    else if (typeof e.msg === 'string' && e.msg) message = e.msg;
    else if (e.error && typeof e.error.message === 'string' && e.error.message) message = e.error.message;
    if (typeof e.details === 'string' && e.details) details = e.details;
    else if (typeof e.hint === 'string' && e.hint) details = e.hint;
  }

  // The client only ever sees a generic message plus a correlation id.
  // Postgres/PostgREST messages, details and hints leak schema, table and
  // constraint names to any caller, so the full picture stays server-side.
  // Routes that need to surface a real, user-facing business message must
  // classify it (BusinessRuleError / ValidationFailure / AuthError) instead
  // of letting it fall through here.
  const errorId = Math.random().toString(36).slice(2, 10);
  console.error(`Server error [${errorId}]:`, message || String(err), details ? `| ${details}` : '', err);

  return NextResponse.json(
    { success: false, message: 'حدث خطأ في الخادم', errorId },
    { status: 500 }
  );
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** A safe, user-facing accounting/business rule violation (not a server fault). */
export class BusinessRuleError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'BusinessRuleError';
    this.status = status;
  }
}

const sb = () => getSupabase();

export async function requireApiAuth(request: Request, options: { checkSubscription?: boolean; skipModuleGuard?: boolean } = {}): Promise<{ companyId: string; userId: string; role: string }> {
  const { extractToken, verifyToken } = await import('@/lib/auth');
  const token = extractToken(request);
  if (!token) throw new AuthError('غير مصرح به');

  const payload = verifyToken(token);
  if (!payload) throw new AuthError('غير مصرح به');

  // Baseline rate limiting for every authenticated business route
  // (auth routes have their own stricter DB-backed limiter).
  await enforceRateLimit(request, `user:${payload.userId}`);

  const s = sb();
  // SECURITY FIX: Fetch role from database (source of truth) instead of JWT token.
  // The JWT role could be stale or manipulated. The DB role is authoritative.
  const { data: user, error: userErr } = await s.from('users')
    .select('company_id, is_active, role, token_version')
    .eq('id', payload.userId)
    .single();

  if (userErr || !user) throw new AuthError('المستخدم غير موجود');
  const u = user;
  if (!u.is_active) throw new AuthError('المستخدم غير نشط', 403);

  // SECURITY: Reject stale tokens (issued before logout / password change).
  const storedVersion = Number(u.token_version) || 0;
  if (payload.ver !== storedVersion) throw new AuthError('غير مصرح به');

  // Company state is part of authentication, not optional metadata. A lookup
  // outage must never reactivate a disabled/deleted tenant.
  const { data: company, error: companyErr } = await s.from('companies')
    .select('is_active').eq('id', u.company_id).single();
  if (companyErr || !company) throw new AuthError('تعذر التحقق من الشركة', 503);
  if ((company as Record<string, any>).is_active !== true) {
    throw new AuthError('الشركة غير نشطة. تواصل مع مدير النظام', 403);
  }

  // Subscription guard: enforce plan state + module gating unless caller
  // explicitly opts out (e.g. login/register flows run before a company/
  // subscription exists yet).
  if (options.checkSubscription !== false && !options.skipModuleGuard) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const { assertSubscriptionAccess } = await import('@/lib/subscription-guard');
      await assertSubscriptionAccess(u.company_id, request.method, url.pathname);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      // Never let an unavailable entitlement lookup grant write access in a
      // deployed system. Reads remain available, but production writes fail
      // closed until the subscription source can be verified.
      console.error('Subscription guard check failed:', e);
      if (process.env.NODE_ENV === 'production' && !['GET', 'HEAD', 'OPTIONS'].includes((request.method || 'GET').toUpperCase())) {
        throw new AuthError('تعذر التحقق من حالة الاشتراك. حاول لاحقاً', 503);
      }
    }
  } else if (options.checkSubscription) {
    // Legacy behavior: expiry-only check (used by callers that still
    // manage module gating themselves).
    try {
      const { getCompanySubscription } = await import('@/lib/subscription');
      const sub = await getCompanySubscription(u.company_id);
      if (sub && sub.is_expired) {
        throw new AuthError('انتهت صلاحية الاشتراك. يرجى تجديد الاشتراك', 403);
      }
    } catch (e) {
      if (e instanceof AuthError) throw e;
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
      `ليس لديك صلاحية لتنفيذ هذا الإجراء. الصلاحيات المطلوبة: ${allowedRoles.join(' أو ')}. دورك الحالي: ${auth.role}`,
      403
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

/**
 * RBAC + Module Permission Check
 * يتحقق من الدور AND الصلاحيات المخصصة للوحدة
 * إذا كانت الصلاحيات المخصصة فارغة [] → ممنوع الوصول تماماً
 */
export async function requireModulePermission(
  request: Request,
  module: string,
  action: string
): Promise<{ companyId: string; userId: string; role: string }> {
  const auth = await requireApiAuth(request);

  // الأدمن دائماً لديه صلاحية
  if (auth.role === 'admin') return auth;

  // التحقق من الصلاحيات المخصصة والدور
  const { hasModulePermission } = await import('@/lib/permissions');
  const allowed = await hasModulePermission(auth.userId, auth.companyId, module, action);

  if (!allowed) {
    throw new AuthError(
      `ليس لديك صلاحية "${action}" على "${module}". تواصل مع مدير النظام.`,
      403
    );
  }

  return auth;
}

export async function requireAdminAuth(request: Request): Promise<{ userId: string; email: string }> {
  // Delegate to the central admin guard which enforces the ADMIN_TOKEN_SECRET
  // signature, role=superadmin, and admin_users.is_active check.
  try {
    const { requireAdmin } = await import('@/lib/admin-guard');
    const ctx = await requireAdmin(request);
    return { userId: ctx.adminId, email: ctx.email };
  } catch (e) {
    throw new AuthError('غير مصرح به');
  }
}

export function handleApiError(err: unknown) {
  if (err instanceof AuthError || err instanceof BusinessRuleError) return error(err.message, err.status);

  // PostgreSQL is the final authority and may reject a posting after the
  // route-level check (for example when a fiscal year closes concurrently).
  // Translate only these allow-listed accounting rules; never expose arbitrary
  // database/schema errors to production users.
  const databaseMessage = err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
    ? String((err as { message: string }).message)
    : '';
  if (/لا يمكن الترحيل إلى سنة مالية مقفلة|cannot post to a closed fiscal year/i.test(databaseMessage)) {
    return error('لا يمكن تسجيل العملية لأن تاريخها يقع في سنة مالية مقفلة. أعد فتح السنة المالية أو اختر تاريخاً ضمن سنة مفتوحة.', 409);
  }
  if (/لا توجد سنة مالية مفتوحة تغطي تاريخ العملية/i.test(databaseMessage)) {
    return error('تاريخ العملية خارج نطاق السنة المالية المفتوحة. أنشئ أو افتح سنة مالية تغطي هذا التاريخ ثم أعد المحاولة.', 409);
  }

  if (err instanceof ValidationFailure) return validationError(err.errors ?? err.message);
  if (err instanceof RateLimitExceeded) {
    const res = error('عدد كبير جداً من الطلبات، حاول لاحقاً', 429);
    res.headers.set('Retry-After', String(err.retryAfterSeconds));
    return res;
  }
  return serverError(err);
}

/** Thrown by enforceRateLimit; mapped to a 429 in handleApiError. */
export class RateLimitExceeded extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceeded';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Per-user (or per-IP for anonymous callers) rate limiting for business
 * routes. Reads get a higher budget than writes. Called automatically from
 * requireApiAuth so every authenticated route is covered without per-handler
 * wiring; can also be invoked directly for public endpoints.
 */
export async function enforceRateLimit(request: Request, principal: string): Promise<void> {
  const { hitRateLimit, READ_LIMIT, WRITE_LIMIT } = await import('@/lib/memory-rate-limit');
  const method = (request?.method || 'GET').toUpperCase();
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT;
  const result = hitRateLimit(`${principal}:${isWrite ? 'w' : 'r'}`, limit);
  if (!result.allowed) {
    throw new RateLimitExceeded(result.retryAfterSeconds);
  }
}

export async function parseBody<T = any>(request: Request): Promise<T> {
  const body = await request.json();
  // Harden: handlers universally treat the body as a plain object
  // (`body.field`). Arrays / primitives / null silently produce `undefined`
  // fields deep in business logic — reject them up-front instead.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationFailure('صيغة الطلب غير صحيحة: يجب إرسال كائن JSON');
  }
  return body as T;
}

/** Thrown by parseBody / parseValidatedBody; mapped to a 422 in handleApiError. */
export class ValidationFailure extends Error {
  errors?: Record<string, string[]> | string;
  constructor(message: string, errors?: Record<string, string[]> | string) {
    super(message);
    this.name = 'ValidationFailure';
    this.errors = errors;
  }
}

/**
 * Parse the JSON body and validate it against a Zod schema in one step.
 * Prefer this over bare `parseBody` for every new write handler:
 *
 *   const body = await parseValidatedBody(request, invoiceSchema);
 */
export async function parseValidatedBody<S extends { safeParse: (v: unknown) => any }>(
  request: Request,
  schema: S
): Promise<S extends { safeParse: (v: unknown) => { success: true; data: infer D } | any } ? D : never> {
  const raw = await parseBody(request);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // All production callers pass Zod schemas, whose errors always expose
    // `flatten()`. Keeping a non-Zod fallback created an untestable branch and
    // hid programming errors in callers.
    const flat = parsed.error.flatten().fieldErrors;
    throw new ValidationFailure('بيانات غير صالحة', flat);
  }
  return parsed.data;
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
