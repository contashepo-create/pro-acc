import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export async function GET() {
  const token = randomBytes(32).toString('hex');
  const response = NextResponse.json({ token });
  response.cookies.set('csrf_token', token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return response;
}
