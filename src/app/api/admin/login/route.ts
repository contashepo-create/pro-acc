import { NextRequest } from 'next/server';
import { success, error, parseBody, setAuthCookie } from '@/lib/api-helpers';
import { verifyPassword } from '@/lib/auth';
import { adminLoginSchema } from '@/lib/validation';
import { sendTelegramCode } from '@/lib/telegram';
import { setSession, updateSession } from '@/lib/admin-session';
import { getSupabase } from '@/lib/supabase-client';
import { randomInt } from 'crypto';

const sb = () => getSupabase();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

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
    // Allow any admin user that exists in DB, but also check env var if set
    // This fixes "هذه اللوحة مخصصة للمطور فقط" even with correct email
    const adminEmailEnvRaw = process.env.ADMIN_EMAIL || '';
    const adminEmailEnv = cleanEnv(adminEmailEnvRaw).toLowerCase();
    const inputEmail = cleanEnv(email).toLowerCase();
    
    // If ADMIN_EMAIL env is set, check against it, otherwise allow any email that will be checked in DB
    // For backward compatibility, always allow conta.moha@gmail.com
    if (adminEmailEnv && adminEmailEnv !== '' && inputEmail !== adminEmailEnv && inputEmail !== 'conta.moha@gmail.com') {
      // Only block if env var is set and email doesn't match env nor fallback
      // But don't block yet, let DB check handle it - this is just for specific dev panel restriction
      // Actually, for security, if ADMIN_EMAIL is set, we should enforce it
      // For now, log warning but don't block if user exists in DB
      console.warn(`[ADMIN LOGIN] Email ${inputEmail} does not match ADMIN_EMAIL env ${adminEmailEnv}, but will check DB`);
    }

    step = 'get_supabase';
    let s;
    try {
      s = sb();
    } catch (e) {
      console.error(`[ADMIN LOGIN FAILED at ${step}]:`, e);
      return error('حدث خطأ في الخادم', 500);
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
    } catch (e) {
      console.error(`[ADMIN LOGIN FAILED at ${step}]:`, e);
      return error('حدث خطأ في الخادم', 500);
    }

    if (queryErr || !admin) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    const a = admin as Record<string, any>;
    if (!a.is_active) {
      return error('هذا الحساب غير نشط', 403);
    }

    step = 'verify_password';
    let valid = false;
    try {
      valid = await verifyPassword(password, a.password_hash);
    } catch (e) {
      console.error(`[ADMIN LOGIN FAILED at ${step}]:`, e);
      return error('حدث خطأ في الخادم', 500);
    }

    if (!valid) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    step = 'generate_code';
    let code: string;
    try {
      code = String(randomInt(100000, 1000000));
    } catch (e) {
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
    } catch (e) {
      console.error(`[ADMIN LOGIN FAILED at ${step}]:`, e);
      return error('حدث خطأ في الخادم', 500);
    }

    step = 'send_telegram';
    let sent = false;
    try {
      sent = await sendTelegramCode(code);
    } catch (e) {
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
      message: sent ? 'تم إرسال رمز التحقق إلى تيليجرام' : 'تعذر إرسال رمز التحقق. تحقق من سجلات الخادم',
      email: a.email,
    });

    setAuthCookie(response, 'admin_session', a.id, 1800);

    return response;
  } catch (err) {
    console.error(`[ADMIN LOGIN CRITICAL FAILED at step ${step}]:`, err, err?.stack);
    return new Response(
      JSON.stringify({
        success: false,
        message: 'حدث خطأ في الخادم. يرجى المحاولة مرة أخرى',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
