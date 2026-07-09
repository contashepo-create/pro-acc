import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyPassword } from '@/lib/auth';
import { adminLoginSchema } from '@/lib/validation';
import { sendTelegramCode } from '@/lib/telegram';
import { setSession, updateSession } from '@/lib/admin-session';
import { getSupabase } from '@/lib/supabase-client';
import { randomInt } from 'crypto';

// @ts-ignore
const sb = () => getSupabase() as any;

// Only this email can access the developer panel
const DEV_EMAIL = 'conta.moha@gmail.com';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string; password: string }>(request);
    const parsed = adminLoginSchema.safeParse(body);
    if (!parsed.success) {
      return error('البريد الإلكتروني أو كلمة المرور غير صالحة');
    }

    const { email, password } = parsed.data;

    // Only allow the developer email
    if (email.toLowerCase() !== DEV_EMAIL) {
      return error('هذه اللوحة مخصصة للمطور فقط', 403);
    }

    const s = sb();

    const { data: admin, error: queryErr } = await s.from('admin_users')
      .select('id, name, email, password_hash, is_active')
      .eq('email', email.toLowerCase())
      .single();

    if (queryErr || !admin) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    const a: any = admin;
    if (!a.is_active) {
      return error('هذا الحساب غير نشط', 403);
    }

    const valid = await verifyPassword(password, a.password_hash);
    if (!valid) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    // Generate 2FA code
    const code = String(randomInt(100000, 1000000));

    await setSession(a.id, {
      email: a.email,
      code,
      step: 'code_sent',
      codeSent: false,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });

    const sent = await sendTelegramCode(code);
    if (!sent) {
      return error('فشل إرسال رمز التحقق. تأكد من إعداد بوت تيليجرام', 500);
    }

    await updateSession(a.id, { codeSent: true });

    const response = success({
      message: 'تم إرسال رمز التحقق إلى تيليجرام',
      email: a.email,
    });

    response.cookies.set('admin_session', a.id, {
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
