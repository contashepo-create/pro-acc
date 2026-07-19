import { NextRequest, NextResponse } from 'next/server';

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

/**
 * دالة مستقلة للتحقق من رموز JWT متوافقة تماماً مع بيئة تشغيل Edge Runtime في Next.js Middleware
 * لا تعتمد على وحدة 'crypto' في Node.js ولا تسحب اتصالات قاعدة البيانات (pg/dns)
 */
async function verifyTokenEdge(token: string): Promise<{ userId: string; role: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    if (headerB64.length < 10 || payloadB64.length < 10 || signatureB64.length < 10) return null;
    
    let payloadJson: any;
    try {
      const payloadStr = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
      payloadJson = JSON.parse(payloadStr);
      if (payloadJson.exp && payloadJson.exp < Math.floor(Date.now() / 1000)) return null;
    } catch { return null; }

    const rawSecret = process.env.TOKEN_SECRET;
    const secret = (rawSecret || '').replace(/^\uFEFF/, '').trim();
    if (!secret) return null;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', 
      keyData, 
      { name: 'HMAC', hash: 'SHA-256' }, 
      false, 
      ['sign', 'verify']
    );

    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = Uint8Array.from(
      atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), 
      (c) => c.charCodeAt(0)
    );

    const expectedSig = await crypto.subtle.sign('HMAC', cryptoKey, data);
    const expectedBytes = new Uint8Array(expectedSig);
    if (expectedBytes.length !== signatureBytes.length) return null;

    let diff = 0;
    for (let i = 0; i < expectedBytes.length; i++) diff |= expectedBytes[i] ^ signatureBytes[i];
    if (diff !== 0) return null;

    return { userId: payloadJson.sub, role: payloadJson.role };
  } catch {
    return null;
  }
}

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
      const payload = await verifyTokenEdge(token);
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
      const payload = await verifyTokenEdge(token);
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
