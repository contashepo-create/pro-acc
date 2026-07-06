import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { adminLoginSchema } from '@/lib/validation';
import { sendTelegramCode } from '@/lib/telegram';
import { setSession, updateSession } from '@/lib/admin-session';
import { randomInt } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string; password: string }>(request);
    const parsed = adminLoginSchema.safeParse(body);
    if (!parsed.success) {
      return error('البريد الإلكتروني أو كلمة المرور غير صالحة');
    }

    const { email, password } = parsed.data;

    const res = await query(
      `SELECT id, name, email, password_hash, is_active
       FROM admin_users
       WHERE email = LOWER($1)`,
      [email]
    );

    if (res.rows.length === 0) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    const admin = res.rows[0];

    if (!admin.is_active) {
      return error('هذا الحساب غير نشط', 403);
    }

    const valid = await verifyPassword(password, admin.password_hash);
    if (!valid) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    const code = String(randomInt(100000, 1000000));

    await setSession(admin.id, {
      email: admin.email,
      code,
      step: 'code_sent',
      codeSent: false,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    await sendTelegramCode(code);

    await updateSession(admin.id, { codeSent: true });

    const response = success({
      message: 'تم إرسال رمز التحقق إلى تيليجرام',
      email: admin.email,
    });

    response.cookies.set('admin_session', admin.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 1800,
      path: '/',
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
