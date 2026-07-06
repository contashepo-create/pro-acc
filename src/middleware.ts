import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_PATH = process.env.ADMIN_PATH || 'zerocold';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin panel middleware
  if (pathname.startsWith(`/${ADMIN_PATH}`)) {
    // Allow login pages and static files
    if (pathname === `/${ADMIN_PATH}/login` ||
        pathname === `/${ADMIN_PATH}/verify-telegram` ||
        pathname === `/${ADMIN_PATH}/verify-master` ||
        pathname.includes('/_next/') ||
        pathname.includes('/api/admin/login') ||
        pathname.includes('/api/admin/verify-telegram') ||
        pathname.includes('/api/admin/verify-master')) {
      return NextResponse.next();
    }

    // Check admin authentication for protected admin routes
    const adminToken = request.cookies.get('admin_token')?.value;
    if (!adminToken) {
      return NextResponse.redirect(new URL(`/${ADMIN_PATH}/login`, request.url));
    }

    // Validate token format (basic check - server validates fully)
    if (adminToken.length < 20) {
      return NextResponse.redirect(new URL(`/${ADMIN_PATH}/login`, request.url));
    }
  }

  // Dashboard API authentication middleware
  if (pathname.startsWith('/api/') &&
      !pathname.startsWith('/api/auth/login') &&
      !pathname.startsWith('/api/auth/setup') &&
      !pathname.startsWith('/api/auth/me') &&
      !pathname.startsWith('/api/admin/')) {
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

  // Auth page redirects
  if (pathname === '/login') {
    const token = request.cookies.get('token')?.value;
    if (token) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|fonts).*)',
  ],
};
