import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { sendTelegramCode } from '@/lib/telegram';
import { getSession } from '@/lib/admin-session';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email) return error('Email required');

    const adminId = request.cookies.get('admin_session')?.value;
    if (!adminId) return error('انتهت صلاحية الجلسة', 401);

    const session = await getSession(adminId);
    if (!session) return error('انتهت صلاحية الجلسة', 401);
    if (session.email !== email) return error('البريد الإلكتروني غير متطابق مع الجلسة', 401);

    if (session.codeSent) {
      return success({ message: 'تم إرسال الرمز مسبقاً', alreadySent: true });
    }

    session.codeSent = true;
    await sendTelegramCode(session.code);
    return success({ message: 'تم إرسال رمز التحقق' });
  } catch (err) {
    return serverError(err);
  }
}
