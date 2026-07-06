import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyPassword, createToken } from '@/lib/auth';
import { getSession, deleteSession } from '@/lib/admin-session';

export async function POST(request: NextRequest) {
  try {
    const { email, masterPassword } = await parseBody<{ email: string; masterPassword: string }>(request);

    if (!masterPassword) {
      return error('كلمة المرور الرئيسية مطلوبة');
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

    if (session.step !== 'telegram_verified') {
      return error('يرجى التحقق من رمز تيليجرام أولاً', 401);
    }

    const res = await query(
      `SELECT id, name, email, master_password_hash, is_active
       FROM admin_users
       WHERE email = LOWER($1)`,
      [session.email]
    );

    if (res.rows.length === 0) {
      return error('المستخدم غير موجود', 401);
    }

    const admin = res.rows[0];

    if (!admin.is_active) {
      return error('هذا الحساب غير نشط', 403);
    }

    if (!admin.master_password_hash) {
      return error('لم يتم تعيين كلمة مرور رئيسية لهذا الحساب', 403);
    }

    const valid = await verifyPassword(masterPassword, admin.master_password_hash);
    if (!valid) {
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    const token = createToken(admin.id, 'superadmin');

    await deleteSession(adminId);

    const response = success({
      message: 'تم تسجيل الدخول بنجاح',
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: 'superadmin',
      },
      token,
    });

    response.cookies.set('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 86400,
      path: '/',
    });

    response.cookies.set('admin_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
