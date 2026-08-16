import { NextResponse } from 'next/server';

/**
 * Legacy callback endpoint. Telegram callbacks are accepted only by the
 * secret-token protected /api/telegram/webhook endpoint.
 */
export async function POST() {
  return NextResponse.json({ success: false, message: 'Gone' }, { status: 410 });
}

export async function GET() {
  return NextResponse.json({ success: false, message: 'Gone' }, { status: 410 });
}
