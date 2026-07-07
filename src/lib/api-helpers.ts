import { NextResponse } from 'next/server';

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

export async function requireApiAuth(request: Request): Promise<{ companyId: string; userId: string; role: string }> {
  const { extractToken, verifyToken } = await import('@/lib/auth');
  const { query } = await import('@/lib/db');

  const token = extractToken(request);
  if (!token) throw new AuthError('غير مصرح به');

  const payload = verifyToken(token);
  if (!payload) throw new AuthError('غير مصرح به');

  const res = await query('SELECT company_id FROM users WHERE id = $1', [payload.userId]);
  if (res.rows.length === 0) throw new AuthError('المستخدم غير موجود');

  // Update last activity (fire-and-forget, non-blocking)
  query('UPDATE users SET last_activity = NOW() WHERE id = $1', [payload.userId]).catch(() => {});

  return { companyId: res.rows[0].company_id, userId: payload.userId, role: payload.role };
}

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthError'; }
}

export async function requireAdminAuth(request: Request): Promise<{ userId: string; email: string }> {
  const req = request as any;
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
  if (process.env.NODE_ENV !== 'production') return true;

  const csrfToken = request.headers.get('x-csrf-token');
  const csrfCookie = (request as any).cookies?.get?.('csrf_token')?.value;

  if (!csrfToken || !csrfCookie) return false;
  return csrfToken === csrfCookie;
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
