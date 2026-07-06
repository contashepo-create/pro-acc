import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSession, updateSession } from '@/lib/admin-session';

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await parseBody<{ email: string; code: string }>(request);

    if (!code || !/^\d{6}$/.test(code)) {
      return error('رمز التحقق غير صالح');
    }

    const adminId = request.cookies.get('admin_session')?.value;
    if (!adminId) {
      return error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى', 401);
    }

    const session = await getSession(adminId);
    if (!session) {
      return error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى', 401);
    }

    if (session.email !== email.trim().toLowerCase()) {
      return error('البريد الإلكتروني غير متطابق مع الجلسة', 401);
    }

    if (session.code !== code) {
      return error('رمز التحقق غير صحيح', 401);
    }

    await updateSession(adminId, { step: 'telegram_verified' });

    return success({ message: 'تم التحقق من رمز تيليجرام بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
