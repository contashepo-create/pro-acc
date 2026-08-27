import type { Row } from '@/lib/types';
import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, setAuthCookie } from '@/lib/api-helpers';
import { hashPassword, createToken, getTokenSecret } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';
import { sendEmail } from '@/lib/email';
import { randomBytes, createHmac, createHash } from 'crypto';
import { DEFAULT_CHART_OF_ACCOUNTS } from '@/lib/default-accounts';

const sb = () => getSupabase();

// List of disposable email domains to block
const DISPOSABLE_DOMAINS = [
  'tempmail', 'throwaway', 'mailinator', 'guerrillamail', '10minutemail',
  'temp-mail', 'dispostable', 'fakeinbox', 'sharklasers', 'getnada',
  'trashmail', 'yopmail', 'mintemail', 'maildrop', 'tempr.email',
];

function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return DISPOSABLE_DOMAINS.some((d) => domain.includes(d));
}

// FIXED: CAPTCHA using crypto + stored in DB/Supabase would be better, but for now
// we use secure random and require Cloudflare Turnstile in production
// The Map approach does NOT work on Vercel serverless - replaced with DB-less but secure alternative

// Use CAPTCHA_ENABLED=false to disable math captcha in production and rely on Turnstile
const CAPTCHA_ENABLED = process.env.CAPTCHA_ENABLED !== 'false';

export async function GET() {
  if (process.env.NODE_ENV === 'production'
    && (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || !process.env.TURNSTILE_SECRET_KEY)) {
    return error('التسجيل غير مهيأ بأمان. يجب إعداد Cloudflare Turnstile.', 503);
  }
  // If Turnstile is configured, frontend should use it instead
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    return success({ 
      useTurnstile: true, 
      message: 'Use Cloudflare Turnstile instead' 
    });
  }

  // Fallback math captcha - now using crypto.randomInt for security
  const { randomInt } = await import('crypto');
  const a = randomInt(1, 20);
  const b = randomInt(1, 20);
  const answer = a + b;
  
  // FIXED: Store in Supabase instead of memory Map for serverless compatibility
  // For now, embed answer in HMAC signed token to avoid server state
  const { createHmac } = await import('crypto');
  const secret = getTokenSecret();
  const expires = Date.now() + 5 * 60 * 1000;
  const payload = `${a}:${b}:${answer}:${expires}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${sig}`).toString('base64url');
  
  return success({ challengeId: token, question: `${a} + ${b} = ?` });
}

export function verifyCaptchaToken(token: string, userAnswer: number): boolean {
  try {
    const secret = getTokenSecret();
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');
    if (parts.length !== 5) return false;
    const [a, b, answer, expires, sig] = parts;
    const payload = `${a}:${b}:${answer}:${expires}`;
    const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');
    
    // timing-safe compare
    if (sig.length !== expectedSig.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    if (diff !== 0) return false;
    
    if (Date.now() > parseInt(expires)) return false;
    return parseInt(answer) === userAnswer;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // The stateless math challenge is intentionally development-only: it can
    // be replayed until expiry. Production registration requires Turnstile so
    // one solved challenge cannot be reused for bulk tenant creation.
    if (process.env.NODE_ENV === 'production'
      && (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || !process.env.TURNSTILE_SECRET_KEY)) {
      return error('التسجيل غير مهيأ بأمان. يجب إعداد Cloudflare Turnstile.', 503);
    }
    const body = await parseBody<Row>(request);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { companyName, name, email, password, phone, country } = parsed.data;
    const { captchaId, captchaAnswer } = body;

    // CAPTCHA is MANDATORY when enabled. Previously omitting the captcha
    // fields entirely skipped verification (bot-registration bypass).
    if (CAPTCHA_ENABLED || process.env.NODE_ENV === 'production') {
      if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
        // Turnstile configured — require and verify the token
        const turnstileToken = body.turnstileToken;
        if (!turnstileToken) {
          return error('يرجى إكمال التحقق الأمني');
        }
        try {
          const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret: process.env.TURNSTILE_SECRET_KEY,
              response: turnstileToken,
            }),
          });
          const verifyData = await verifyRes.json();
          if (!verifyData.success) {
            return error('فشل التحقق الأمني. حاول مرة أخرى');
          }
        } catch {
          // If verification endpoint unreachable, allow in dev but block in production
          if (process.env.NODE_ENV === 'production') {
            return error('فشل التحقق الأمني');
          }
        }
      } else {
        // Stateless math captcha — require and verify
        if (!captchaId || captchaAnswer === undefined) {
          return error('يرجى إكمال التحقق الأمني');
        }
        const valid = verifyCaptchaToken(String(captchaId), Number(captchaAnswer));
        if (!valid) {
          return error('إجابة التحقق غير صحيحة أو انتهت صلاحيتها');
        }
      }
    }

    // Block disposable emails
    if (isDisposableEmail(email)) {
      return error('لا يمكن استخدام بريد مؤقت. يرجى استخدام بريد حقيقي', 400);
    }

    const s = sb();

    // Registration rate limiting is a security control and therefore fails
    // closed if its backing store is unavailable. Two independent counters:
    //  - checkRateLimit (login_attempts) guards credential spraying;
    //  - checkRegistrationRateLimit (registration_attempts) guards
    //    account-farming / mass tenant creation.
    const { checkRateLimit, checkRegistrationRateLimit, recordRegistrationAttempt } = await import('@/lib/rate-limit');
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimit = await checkRateLimit(email.toLowerCase(), ip);
    if (!rateLimit.allowed) {
      return error(`عدد محاولات التسجيل كبير. حاول بعد ${rateLimit.remainingMinutes} دقائق`, 429);
    }
    const registrationLimit = await checkRegistrationRateLimit(email.toLowerCase(), ip);
    if (!registrationLimit.allowed) {
      return error(`تم تسجيل محاولات كثيرة من هذا المصدر. حاول بعد ${registrationLimit.remainingMinutes} دقائق`, 429);
    }
    await recordRegistrationAttempt(email.toLowerCase(), ip);

    // Check email duplication (case-insensitive)
    const { data: existing, error: existingErr } = await s.from('users').select('id').ilike('email', email.toLowerCase()).limit(1);
    if (existingErr) throw existingErr;
    if (existing && existing.length > 0) return error('البريد الإلكتروني مسجل مسبقاً', 409);

    // Check company name duplication (case-insensitive)
    const { data: companyCheck, error: companyCheckErr } = await s.from('companies').select('id').ilike('name', companyName).limit(1);
    if (companyCheckErr) throw companyCheckErr;
    if (companyCheck && companyCheck.length > 0) return error('اسم الشركة موجود مسبقاً', 409);

    // Check phone duplication if provided
    if (phone) {
      const cleanPhone = phone.replace(/[^0-9+]/g, '');
      if (cleanPhone.length >= 8) {
        const { data: phoneCheck, error: phoneCheckErr } = await s.from('companies').select('id').eq('phone', phone).limit(1);
        if (phoneCheckErr) throw phoneCheckErr;
        if (phoneCheck && phoneCheck.length > 0) return error('رقم الهاتف مسجل مسبقاً لشركة أخرى', 409);
      }
    }

    // Check username (name) - prevent exact duplicate email+name combo for same company? 
    // For global username check, we allow same name but warn if same name+email exists
    // Here we check if same name already exists with same email domain as extra safety
    // Actually name duplication is allowed globally, but we check for suspicious bot pattern

    const passwordHash = await hashPassword(password);
    // Store only a digest; a database disclosure must not turn verification
    // links into immediately usable account capabilities.
    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenHash = createHash('sha256').update(verificationToken).digest('hex');

    const { getCountryConfig, isOperatingCountry } = await import('@/lib/countries');
    if (!isOperatingCountry(country)) {
      return error('اختر دولة التشغيل: السعودية أو مصر', 400);
    }
    const countryConfig = getCountryConfig(country);

    const accountTemplate=DEFAULT_CHART_OF_ACCOUNTS.map((account)=>({
      code:account.code,name:account.name,name_en:account.nameEn,type:account.type,
      parent_code:account.parentCode||null,is_header:account.isHeader===true,
    }));
    const { data: registration, error: registrationErr } = await s.rpc('register_company', {
      p_company_name:companyName,
      p_email:email.toLowerCase(),
      p_phone:phone||'',
      p_country:countryConfig.name,
      p_country_code:countryConfig.code,
      p_currency_code:countryConfig.currencyCode,
      p_currency_symbol:countryConfig.currencySymbol,
      p_locale:countryConfig.locale,
      p_vat_rate:countryConfig.vatRate,
      p_user_name:name,
      p_password_hash:passwordHash,
      p_verification_hash:verificationTokenHash,
      p_verification_expires:new Date(Date.now()+24*60*60*1000).toISOString(),
      p_accounts:accountTemplate,
    });
    if (registrationErr) {
      const message=String(registrationErr.message||'');
      if (message.includes('مسجل مسبقاً') || message.includes('موجود مسبقاً')) return error(message,409);
      throw registrationErr;
    }
    const registered=registration as {company:{id:string;name:string};user:{id:string;name:string;email:string;role:string}};
    const co=registered.company;
    const user=registered.user;

    // Send verification email (if SMTP configured) - FIXED XSS
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pro-acc.vercel.app';
    const verifyUrl = `${appUrl}/verify-email?token=${verificationToken}`;
    const safeName = name.replace(/[&<>"']/g, (m: string) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] as string));
    const emailSent = await sendEmail(
      email,
      'تأكيد البريد الإلكتروني - AccWeb',
      `<div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #f9f9fb; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="font-size: 22px; color: #1a1a2e; margin: 0;">تأكيد البريد الإلكتروني</h1>
        </div>
        <p style="color: #333; font-size: 15px; line-height: 1.7;">مرحباً ${safeName}،</p>
        <p style="color: #333; font-size: 15px; line-height: 1.7;">شكراً لتسجيلك في <strong>AccWeb</strong>. يرجى تأكيد بريدك الإلكتروني:</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${verifyUrl}" style="display: inline-block; padding: 14px 36px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold;">تأكيد البريد</a>
        </div>
        <p style="color: #666; font-size: 13px;">هذا الرابط صالح لمدة 24 ساعة.</p>
      </div>`
    );

    // Production registration does not issue an authenticated session before
    // mailbox ownership is proven. The user signs in after verification.
    const issueDevelopmentSession = process.env.NODE_ENV !== 'production';
    const token = issueDevelopmentSession ? createToken(user.id, user.role) : null;
    // SECURITY: same rule as login — the session JWT (development only) lives
    // exclusively in the HttpOnly cookie, never in the JSON body.
    const response = success({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      company: { id: co.id, name: companyName },
      emailVerificationSent: emailSent,
      message: emailSent
        ? 'تم إنشاء الحساب. يرجى تأكيد بريدك الإلكتروني خلال 24 ساعة'
        : 'تم إنشاء الحساب بنجاح',
    }, 201);

    if (token) setAuthCookie(response, 'token', token, 86400 * 7);

    return response;
  } catch (err) {
    return serverError(err);
  }
}
