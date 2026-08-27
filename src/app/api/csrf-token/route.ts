import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

const isHttps = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

export async function GET() {
  const token = randomBytes(32).toString('hex');
  const response = NextResponse.json({ token });
  response.cookies.set('csrf_token', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
  });
  return response;
}
