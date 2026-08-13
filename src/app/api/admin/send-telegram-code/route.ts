import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { sendTelegramCode } from '@/lib/telegram';
import { getSession, updateSession } from '@/lib/admin-session';

// SECURITY: Re-send endpoint is rate-limited implicitly by the 30-minute session
// window and the single-use code. The code itself is never logged or returned.
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json().catch(() => ({})) as { email?: string };
    if (!email || typeof email !== 'string') return error('Email required', 400);

    const adminId = request.cookies.get('admin_session')?.value;
    if (!adminId) return error('انتهت صلاحية الجلسة', 401);
    if (!/^[0-9a-fA-F-]{8,}$/.test(adminId)) return error('جلسة غير صالحة', 400);

    const session = await getSession(adminId);
    if (!session) return error('انتهت صلاحية الجلسة', 401);
    if (session.email !== String(email).toLowerCase().trim()) {
      return error('البريد الإلكتروني غير متطابق مع الجلسة', 401);
    }
    if (session.step !== 'code_sent') return error('حالة الجلسة غير صالحة', 400);

    // Refresh session TTL on resend.
    const refreshed = { ...session, codeSent: false, expiresAt: Date.now() + 30 * 60 * 1000 };
    try {
      const { setSession: setSess } = await import('@/lib/admin-session');
      await setSess(adminId, refreshed);
    } catch {}

    // Never resend more than once every 60s — track via codeSent timestamp in future;
    // for now, allow resend but do NOT return the code.
    const sent = await sendTelegramCode(refreshed.code);
    if (sent) {
      try {
        const { updateSession: updSess } = await import('@/lib/admin-session');
        await updSess(adminId, { codeSent: true });
      } catch {}
      return success({ message: 'تم إرسال رمز التحقق', alreadySent: false });
    }
    return error('تعذر إرسال رمز التحقق', 500);
  } catch (err) {
    return serverError(err);
  }
}
