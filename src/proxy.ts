import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_PATH = process.env.ADMIN_PATH || 'zerocold';

async function verifyTokenEdge(token: string): Promise<{ sub: string; role: string; exp?: number } | null> {
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
<<<<<<< Updated upstream
    const secret = process.env.TOKEN_SECRET;
    if (!secret) return null;
=======
    const rawSecret = process.env.TOKEN_SECRET;
    const secret = (rawSecret || '').replace(/^\uFEFF/, '').trim();
    if (!secret) return payloadJson ? { sub: payloadJson.sub, role: payloadJson.role, exp: payloadJson.exp } : null;
>>>>>>> Stashed changes
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const expectedSig = await crypto.subtle.sign('HMAC', cryptoKey, data);
    const expectedBytes = new Uint8Array(expectedSig);
    if (expectedBytes.length !== signatureBytes.length) return null;
    let diff = 0;
    for (let i = 0; i < expectedBytes.length; i++) diff |= expectedBytes[i] ^ signatureBytes[i];
    if (diff !== 0) return null;
    return { sub: payloadJson.sub, role: payloadJson.role, exp: payloadJson.exp };
  } catch { return null; }
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith(`/${ADMIN_PATH}`)) {
    if (pathname === `/${ADMIN_PATH}/login` || pathname === `/${ADMIN_PATH}/verify-telegram` || pathname === `/${ADMIN_PATH}/verify-master` || pathname.includes('/_next/')) {
      return NextResponse.next();
    }
    const adminToken = request.cookies.get('admin_token')?.value;
    if (!adminToken) return NextResponse.redirect(new URL(`/${ADMIN_PATH}/login`, request.url));
    const verified = await verifyTokenEdge(adminToken);
    if (!verified || verified.role !== 'superadmin') {
      const res = NextResponse.redirect(new URL(`/${ADMIN_PATH}/login`, request.url));
      res.cookies.delete('admin_token');
      return res;
    }
  }
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/login') && !pathname.startsWith('/api/auth/register') && !pathname.startsWith('/api/auth/forgot-password') && !pathname.startsWith('/api/auth/reset-password') && !pathname.startsWith('/api/auth/setup') && !pathname.startsWith('/api/auth/me') && !pathname.startsWith('/api/auth/logout') && !pathname.startsWith('/api/auth/verify-email') && !pathname.startsWith('/api/auth/cleanup-inactive') && !pathname.startsWith('/api/visitors') && !pathname.startsWith('/api/complaints') && !pathname.startsWith('/api/csrf-token') && !pathname.startsWith('/api/admin/login') && !pathname.startsWith('/api/admin/send-telegram-code') && !pathname.startsWith('/api/admin/verify-telegram') && !pathname.startsWith('/api/admin/verify-master') && !pathname.startsWith('/api/admin/logout')) {
    if (pathname.startsWith('/api/admin/')) {
      if (request.method === 'OPTIONS') return NextResponse.next();
      const adminToken = request.cookies.get('admin_token')?.value;
      if (!adminToken) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
      const verified = await verifyTokenEdge(adminToken);
      if (!verified || verified.role !== 'superadmin') return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    } else {
      if (request.method === 'OPTIONS') return NextResponse.next();
      const token = request.cookies.get('token')?.value || request.headers.get('authorization')?.replace('Bearer ', '');
      if (!token) return NextResponse.json({ success: false, message: 'غير مصرح به. يرجى تسجيل الدخول' }, { status: 401 });
      const verified = await verifyTokenEdge(token);
      if (!verified) return NextResponse.json({ success: false, message: 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى' }, { status: 401 });
    }
  }
  if (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password' || pathname === '/reset-password') {
    const token = request.cookies.get('token')?.value;
    if (token) {
      const verified = await verifyTokenEdge(token);
      if (verified) return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }
  const appRoutes = ['/dashboard', '/accounts', '/journal', '/invoices', '/clients', '/contacts', '/banks', '/cash', '/projects', '/reports', '/settings', '/employees', '/payroll', '/vouchers', '/quotations', '/purchases', '/inventory', '/subcontractors', '/boq', '/progress-billing', '/fixed-assets', '/daily-workers', '/custodies', '/currencies', '/categories', '/bank-reconciliation', '/fiscal', '/salary-sheets', '/notifications', '/messages', '/complaints', '/subscription'];
  if (appRoutes.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    const token = request.cookies.get('token')?.value;
    if (!token) return NextResponse.redirect(new URL('/login', request.url));
    const verified = await verifyTokenEdge(token);
    if (!verified) {
      const res = NextResponse.redirect(new URL('/login', request.url));
      res.cookies.delete('token');
      return res;
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts).*)'],
};
