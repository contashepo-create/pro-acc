import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_PATH = process.env.ADMIN_PATH || 'zerocold';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin panel middleware
  if (pathname.startsWith(`/${ADMIN_PATH}`)) {
    if (pathname === `/${ADMIN_PATH}/login` ||
        pathname === `/${ADMIN_PATH}/verify-telegram` ||
        pathname === `/${ADMIN_PATH}/verify-master` ||
        pathname.includes('/_next/') ||
        pathname.includes('/api/admin/login') ||
        pathname.includes('/api/admin/verify-telegram') ||
        pathname.includes('/api/admin/verify-master')) {
      return NextResponse.next();
    }

    const adminToken = request.cookies.get('admin_token')?.value;
    if (!adminToken) {
      return NextResponse.redirect(new URL(`/${ADMIN_PATH}/login`, request.url));
    }

    if (adminToken.length < 20) {
      return NextResponse.redirect(new URL(`/${ADMIN_PATH}/login`, request.url));
    }
  }

  // Dashboard API authentication middleware
  if (pathname.startsWith('/api/') &&
      !pathname.startsWith('/api/auth/login') &&
      !pathname.startsWith('/api/auth/register') &&
      !pathname.startsWith('/api/auth/forgot-password') &&
      !pathname.startsWith('/api/auth/reset-password') &&
      !pathname.startsWith('/api/auth/setup') &&
      !pathname.startsWith('/api/auth/me') &&
      !pathname.startsWith('/api/auth/logout') &&
      !pathname.startsWith('/api/auth/verify-email') &&
      !pathname.startsWith('/api/auth/cleanup-inactive') &&
      !pathname.startsWith('/api/debug') &&
      !pathname.startsWith('/api/admin/') &&
      !pathname.startsWith('/api/visitors/') &&
      !pathname.startsWith('/api/visitors')) {
    if (request.method === 'OPTIONS') {
      return NextResponse.next();
    }
    const token = request.cookies.get('token')?.value ||
                  request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token || token.length < 20) {
      return NextResponse.json(
        { success: false, message: 'غير مصرح به. يرجى تسجيل الدخول' },
        { status: 401 }
      );
    }
  }

  // Auth page redirects — if logged in, go to dashboard
  if (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password' || pathname === '/reset-password') {
    const token = request.cookies.get('token')?.value;
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Protect /dashboard and other app routes — redirect to login if no token
  const appRoutes = ['/dashboard', '/accounts', '/journal', '/invoices', '/clients', '/contacts', '/banks', '/cash', '/projects', '/reports', '/settings', '/employees', '/payroll', '/vouchers', '/quotations', '/purchases', '/inventory', '/subcontractors', '/boq', '/progress-billing', '/fixed-assets', '/daily-workers', '/custodies', '/currencies', '/categories', '/bank-reconciliation', '/fiscal', '/salary-sheets', '/notifications', '/messages', '/complaints', '/subscription'];
  if (appRoutes.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    const token = request.cookies.get('token')?.value;
    if (!token || token.length < 20) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|fonts).*)',
  ],
};
