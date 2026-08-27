import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { sendTelegramCode } from '@/lib/telegram';
import { updateSession, parseAdminSessionPointer } from '@/lib/admin-session';
import { randomInt, createHash } from 'crypto';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const OTP_TTL_MS = 5 * 60_000;

/** Reissues a fresh, short-lived OTP for the existing step-1 session. */
export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email?: string }>(request);
    const email = body.email?.trim().toLowerCase();
    if (!email) return error('Email required', 400);

    const sessionCookie = request.cookies.get('admin_session')?.value || '';
    const pointer = parseAdminSessionPointer(sessionCookie);
    if (!pointer) return error('انتهت صلاحية الجلسة', 401);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = Date.now();
    // Serialize cooldown validation and code replacement under the admin row
    // lock so parallel resend calls cannot flood Telegram or invalidate one
    // another unpredictably.
    const { data, error: prepareErr } = await getSupabase().rpc('prepare_admin_otp_resend', {
      p_admin_id: pointer.adminId,
      p_session_id: pointer.sessionId,
      p_email: email,
      p_code_hash: createHash('sha256').update(code).digest('hex'),
      p_now_ms: now,
      p_otp_expires_ms: now + OTP_TTL_MS,
    });
    if (prepareErr) throw prepareErr;
    const status = String((data as Row)?.status || 'invalid_session');
    if (status === 'cooldown') return error('يرجى الانتظار دقيقة قبل إعادة الإرسال', 429);
    if (status !== 'prepared') return error('حالة الجلسة غير صالحة', 401);

    const sent = await sendTelegramCode(code);
    if (!sent) return error('تعذر إرسال رمز التحقق', 500);
    await updateSession(sessionCookie, { codeSent: true });
    return success({ message: 'تم إرسال رمز تحقق جديد' });
  } catch (err) {
    return serverError(err);
  }
}
