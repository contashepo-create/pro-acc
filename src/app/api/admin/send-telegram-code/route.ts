import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { sendTelegramCode } from '@/lib/telegram';
import { getSession, updateSession } from '@/lib/admin-session';
import { randomInt } from 'crypto';

const RESEND_COOLDOWN_MS = 60_000;
const OTP_TTL_MS = 5 * 60_000;

/** Reissues a fresh, short-lived OTP for the existing authenticated step-1 session. */
export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email?: string }>(request);
    const email = body.email;
    if (!email || typeof email !== 'string') return error('Email required', 400);

    const adminId = request.cookies.get('admin_session')?.value;
    if (!adminId || !/^[0-9a-fA-F-]{8,}$/.test(adminId)) return error('انتهت صلاحية الجلسة', 401);

    const session = await getSession(adminId);
    if (!session) return error('انتهت صلاحية الجلسة', 401);
    if (session.email !== email.toLowerCase().trim() || session.step !== 'code_sent') {
      return error('حالة الجلسة غير صالحة', 401);
    }
    if (Date.now() - (session.lastResendAt || 0) < RESEND_COOLDOWN_MS) {
      return error('يرجى الانتظار دقيقة قبل إعادة الإرسال', 429);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = Date.now();
    // Reset the attempt budget when issuing a new code, but never extend the
    // overall session lifetime.
    await updateSession(adminId, {
      code,
      codeSent: false,
      attempts: 0,
      otpExpiresAt: now + OTP_TTL_MS,
      lastResendAt: now,
    });

    const sent = await sendTelegramCode(code);
    if (!sent) return error('تعذر إرسال رمز التحقق', 500);
    await updateSession(adminId, { codeSent: true });
    return success({ message: 'تم إرسال رمز تحقق جديد' });
  } catch (err) {
    return serverError(err);
  }
}
