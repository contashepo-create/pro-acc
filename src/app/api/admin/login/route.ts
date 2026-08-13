import { NextRequest } from 'next/server';
import { success, error, parseBody, setAuthCookie } from '@/lib/api-helpers';
import { verifyPassword } from '@/lib/auth';
import { adminLoginSchema } from '@/lib/validation';
import { sendTelegramCode } from '@/lib/telegram';
import { setSession, updateSession } from '@/lib/admin-session';
import { getSupabase } from '@/lib/supabase-client';
import { randomInt, randomBytes } from 'crypto';
import { auditLog } from '@/lib/admin-auth';

const sb = () => getSupabase();

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

    step = 'normalize_email';
    const inputEmail = cleanEnv(email).toLowerCase();

    // Rate-limit by IP and email to slow brute force against the admin panel.
    // We reuse the app's rate-limit helper; if unavailable, allow-through with
    // a warning (fail-open only when the rate limiter itself is broken).
    try {
      const { checkRateLimit } = await import('@/lib/rate-limit');
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown';
      const rl = await checkRateLimit('admin:' + inputEmail, ip);
      if (!rl.allowed) {
        return error(`تم حظر المحاولات مؤقتاً. حاول بعد ${rl.remainingMinutes} دقائق`, 429);
      }
    } catch (e) {
      console.warn('[ADMIN LOGIN] rate-limit unavailable:', e);
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
    // 6-digit cryptographically secure OTP. Use randomInt (CSPRNG); fallback
    // uses randomBytes (also CSPRNG) — never Math.random which is predictable.
    let code: string;
    try {
      code = String(randomInt(0, 1000000)).padStart(6, '0');
    } catch {
      code = String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');
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
      // SECURITY: NEVER log the 2FA code even if Telegram fails.
      // Previously the code was printed to server logs which allowed anyone with
      // log access (or noisy error-tracking pipelines) to bypass 2FA.
      console.warn(`[ADMIN 2FA] Telegram not configured or failed to send code for ${a.email}`);
      const botToken = cleanEnv(process.env.TELEGRAM_BOT_TOKEN || '');
      if (botToken) {
        return error('تعذر إرسال رمز التحقق عبر تيليجرام. حاول مرة أخرى أو تواصل مع الدعم', 500);
      }
      // If Telegram is NOT configured (dev mode), refuse login instead of
      // leaking the code through logs. Admin must configure TELEGRAM_BOT_TOKEN
      // and TELEGRAM_ADMIN_CHAT_ID before the admin panel is usable.
      return error('لم يتم تكوين إرسال رمز التحقق. يرجى ضبط إعدادات تيليجرام', 503);
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
      message: 'تم إرسال رمز التحقق إلى تيليجرام',
      email: a.email,
    });

    // admin_session is a short-lived server-side pointer (UUID), NOT a JWT.
    // HttpOnly + SameSite=Lax (Strict would break the 2FA redirect flow).
    // Match the server-side session TTL (30 minutes) so the cookie doesn't
    // outlive the server's state.
    setAuthCookie(response, 'admin_session', a.id, 1800); // 30 minutes

    // Audit successful step-1
    try {
      await auditLog(a.id, 'admin_login_step1', 'Password verified, 2FA code sent');
    } catch {}

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
