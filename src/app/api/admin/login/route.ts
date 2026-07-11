import { NextRequest } from 'next/server';
import { success, error, parseBody } from '@/lib/api-helpers';
import { verifyPassword } from '@/lib/auth';
import { adminLoginSchema } from '@/lib/validation';
import { sendTelegramCode } from '@/lib/telegram';
import { setSession, updateSession } from '@/lib/admin-session';
import { getSupabase } from '@/lib/supabase-client';
import { randomInt } from 'crypto';

// @ts-ignore
const sb = () => getSupabase() as any;

const DEV_EMAIL = 'conta.moha@gmail.com';

function cleanEnv(s: string): string {
  return (s || '').replace(/^\uFEFF/, '').trim();
}

export async function POST(request: NextRequest) {
  let step = 'init';
  try {
    step = 'parse_body';
    const body = await parseBody<{ email: string; password: string }>(request);
    const parsed = adminLoginSchema.safeParse(body);
    if (!parsed.success) {
      return error('البريد الإلكتروني أو كلمة المرور غير صالحة: ' + parsed.error.issues[0].message);
    }

    const { email, password } = parsed.data;

    step = 'check_dev_email';
    if (email.toLowerCase() !== DEV_EMAIL) {
      return error('هذه اللوحة مخصصة للمطور فقط', 403);
    }

    step = 'get_supabase';
    let s;
    try {
      s = sb();
    } catch (e: any) {
      console.error(`[ADMIN LOGIN FAILED at ${step}]:`, e);
      return error(`خطأ في الاتصال بقاعدة البيانات (Supabase): ${e.message}`, 500);
    }

    step = 'query_admin_user';
    let admin, queryErr;
    try {
      const result = await s.from('admin_users')
        .select('id, name, email, password_hash, is_active')
        .eq('email', email.toLowerCase())
        .single();
      admin = result.data;
      queryErr = result.error;
    } catch (e: any) {
      console.error(`[ADMIN LOGIN FAILED at ${step}]:`, e);
      return error(`خطأ في قراءة بيانات الأدمن: ${e.message}`, 500);
    }

    if (queryErr || !admin) {
      console.warn(`[ADMIN LOGIN] User not found: ${email}, error:`, queryErr);
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    const a: any = admin;
    if (!a.is_active) {
      return error('هذا الحساب غير نشط', 403);
    }

    step = 'verify_password';
    let valid = false;
    try {
      valid = await verifyPassword(password, a.password_hash);
    } catch (e: any) {
      console.error(`[ADMIN LOGIN FAILED at ${step}]:`, e);
      return error(`خطأ في التحقق من كلمة المرور: ${e.message}`, 500);
    }

    if (!valid) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    step = 'generate_code';
    let code: string;
    try {
      code = String(randomInt(100000, 1000000));
    } catch (e: any) {
      // Fallback if crypto.randomInt not available
      code = String(Math.floor(100000 + Math.random() * 900000));
      console.warn(`[ADMIN LOGIN] randomInt failed, using Math.random fallback:`, e);
    }

    step = 'set_session';
    try {
      await setSession(a.id, {
        email: (a.email || '').toLowerCase(),
        code,
        step: 'code_sent',
        codeSent: false,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });
    } catch (e: any) {
      console.error(`[ADMIN LOGIN FAILED at ${step}]:`, e);
      return error(`خطأ في إنشاء الجلسة: ${e.message}. تأكد من تشغيل SQL: ALTER TABLE admin_users ADD COLUMN login_session_data JSONB`, 500);
    }

    step = 'send_telegram';
    let sent = false;
    try {
      sent = await sendTelegramCode(code);
    } catch (e: any) {
      console.error(`[ADMIN LOGIN] Telegram send failed:`, e);
      sent = false;
    }

    if (!sent) {
      console.warn(`[ADMIN 2FA] Telegram not configured or failed, code for ${a.email}: ${code}`);
      // Don't fail if Telegram not configured, allow login with code from logs
      // Only fail if Telegram IS configured but failed to send
      const botToken = cleanEnv(process.env.TELEGRAM_BOT_TOKEN || '');
      if (botToken) {
        // Telegram configured but failed to send - this is an error
        console.error(`[ADMIN LOGIN] Telegram configured but send failed`);
        // Still allow login but warn - code is in logs
      }
    } else {
      step = 'update_session';
      try {
        await updateSession(a.id, { codeSent: true });
      } catch (e) {
        console.warn(`[ADMIN LOGIN] updateSession failed:`, e);
        // Non-critical, don't fail
      }
    }

    const response = success({
      message: sent ? 'تم إرسال رمز التحقق إلى تيليجرام' : `تم إنشاء الرمز (Telegram غير مربوط). الكود: ${code} - شاهده في Vercel Logs`,
      email: a.email,
      debugCode: !sent ? code : undefined, // Only return code if Telegram failed
    });

    response.cookies.set('admin_session', a.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 1800,
      path: '/',
    });

    return response;
  } catch (err: any) {
    console.error(`[ADMIN LOGIN CRITICAL FAILED at step ${step}]:`, err, err?.stack);
    // Always return detailed error for admin login to help debugging
    return new Response(
      JSON.stringify({
        success: false,
        message: `خطأ في الخادم عند خطوة ${step}: ${err?.message || 'Unknown'} - تأكد من تشغيل SQL وتحديث Vercel Env`,
        step,
        error: err?.message,
        stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
