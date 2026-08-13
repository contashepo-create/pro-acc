import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSession, updateSession } from '@/lib/admin-session';
import { auditLog } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await parseBody<{ email: string; code: string }>(request);

    if (!email || typeof email !== 'string') {
      return error('البريد الإلكتروني مطلوب');
    }
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return error('رمز التحقق غير صالح');
    }

    const adminId = request.cookies.get('admin_session')?.value;
    if (!adminId) {
      return error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى', 401);
    }
    // admin_session cookie is supposed to be a UUID; enforce shape
    if (!/^[0-9a-fA-F-]{8,}$/.test(adminId)) {
      return error('جلسة غير صالحة', 400);
    }

    const session = await getSession(adminId);
    if (!session) {
      return error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى', 401);
    }

    if (session.email.toLowerCase() !== email.trim().toLowerCase()) {
      return error('البريد الإلكتروني غير متطابق مع الجلسة', 401);
    }

    if (session.step !== 'code_sent') {
      return error('حالة الجلسة غير صالحة', 400);
    }

    // Constant-time code comparison to mitigate timing attacks
    let diff = 0;
    const a = String(session.code);
    const b = String(code);
    if (a.length !== b.length) {
      return error('رمز التحقق غير صحيح', 401);
    }
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    if (diff !== 0) {
      return error('رمز التحقق غير صحيح', 401);
    }

    await updateSession(adminId, { step: 'telegram_verified' });
    try { await auditLog(adminId, 'admin_login_step2', 'Telegram 2FA verified'); } catch {}

    return success({ message: 'تم التحقق من رمز تيليجرام بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
