import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/reset-password',
  '/api/portal',
  '/api/portal/*',
  '/api/admin/login',
  '/api/health',
  '/api/telegram/webhook', // Webhook must be public
  '/_next',
  '/static',
  '/public',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public routes and static assets
  if (PUBLIC_ROUTES.some(route => {
    if (route.endsWith('/*')) {
      return pathname.startsWith(route.slice(0, -2));
    }
    return pathname === route || pathname.startsWith(route + '/');
  })) {
    return NextResponse.next();
  }

  // Check for admin routes
  if (pathname.startsWith('/zerocold')) {
    const token = request.cookies.get('admin_token')?.value;
    
    if (!token) {
      const url = request.nextUrl.clone();
      url.pathname = '/zerocold/login';
      return NextResponse.redirect(url);
    }

    try {
      const payload = verifyToken(token);
      if (!payload || payload.role !== 'superadmin') {
        const url = request.nextUrl.clone();
        url.pathname = '/zerocold/login';
        return NextResponse.redirect(url);
      }
    } catch (error) {
      const url = request.nextUrl.clone();
      url.pathname = '/zerocold/login';
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  // Check for dashboard routes
  if (pathname.startsWith('/(dashboard)') || pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('token')?.value;

    if (!token) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }

    try {
      const payload = verifyToken(token);
      if (!payload || !payload.userId) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.searchParams.set('redirect', pathname);
        return NextResponse.redirect(url);
      }
    } catch (error) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};