import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { hashPassword, createToken } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';
import { sendEmail } from '@/lib/email';
import { randomBytes } from 'crypto';

// @ts-ignore
const sb = () => getSupabase() as any;

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

// Simple CAPTCHA verification — math-based
// The client sends a captchaAnswer and we verify it
const captchaChallenges = new Map<string, { question: string; answer: number; expires: number }>();

export async function GET(request: NextRequest) {
  // Generate a CAPTCHA challenge
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  const answer = a + b;
  const challengeId = randomBytes(16).toString('hex');
  captchaChallenges.set(challengeId, {
    question: `${a} + ${b} = ?`,
    answer,
    expires: Date.now() + 5 * 60 * 1000,
  });
  return success({ challengeId, question: `${a} + ${b} = ?` });
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<any>(request);
    const { companyName, name, email, password, phone, captchaId, captchaAnswer } = body;

    // Manual validation
    if (!companyName || !name || !email || !password) {
      return error('جميع الحقول مطلوبة');
    }
    if (password.length < 6) {
      return error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    }

    // Verify CAPTCHA
    if (captchaId && captchaAnswer) {
      const challenge = captchaChallenges.get(captchaId);
      if (!challenge || challenge.expires < Date.now()) {
        return error('انتهت صلاحية التحقق. يرجى المحاولة مرة أخرى');
      }
      if (Number(captchaAnswer) !== challenge.answer) {
        return error('إجابة التحقق غير صحيحة');
      }
      captchaChallenges.delete(captchaId);
    }

    // Block disposable emails
    if (isDisposableEmail(email)) {
      return error('لا يمكن استخدام بريد مؤقت. يرجى استخدام بريد حقيقي', 400);
    }

    const s = sb();

    const { data: existing } = await s.from('users').select('id').eq('email', email.toLowerCase()).limit(1);
    if (existing && existing.length > 0) return error('البريد الإلكتروني مسجل مسبقاً', 409);

    const { data: companyCheck } = await s.from('companies').select('id').eq('name', companyName).limit(1);
    if (companyCheck && companyCheck.length > 0) return error('اسم الشركة موجود مسبقاً', 409);

    const passwordHash = await hashPassword(password);
    const verificationToken = randomBytes(32).toString('hex');

    const { data: company, error: companyErr } = await s.from('companies')
      .insert({ name: companyName, email: email.toLowerCase(), phone: phone || null, is_active: true })
      .select('id').single();
    if (companyErr || !company) return error('فشل إنشاء الشركة', 500);
    const co: any = company;

    // Try with email_verified column, fall back without
    const insertData: any = {
      company_id: co.id, name, email: email.toLowerCase(), password_hash: passwordHash,
      role: 'admin', is_active: true,
    };
    let user: any = null;
    const { data: u1, error: e1 } = await s.from('users')
      .insert({ ...insertData, email_verified: false, email_verification_token: verificationToken, email_verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
      .select('id, name, email, role').single();
    if (e1) {
      // Column doesn't exist — create without email_verified
      const { data: u2, error: e2 } = await s.from('users')
        .insert(insertData).select('id, name, email, role').single();
      if (e2 || !u2) return error('فشل إنشاء المستخدم', 500);
      user = u2;
    } else {
      user = u1;
    }
    if (!user) return error('فشل إنشاء المستخدم', 500);

    // Create trial subscription
    try {
      const { data: plan } = await s.from('subscription_plans').select('id').eq('code', 'trial').eq('is_active', true).limit(1).single();
      const p: any = plan;
      if (p) {
        await s.from('subscriptions').upsert({
          company_id: co.id, plan_id: p.id, plan_code: 'trial', status: 'trial',
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          trial_end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          auto_renew: false,
        }, { onConflict: 'company_id' });
      }
    } catch {}

    // Send verification email (if SMTP configured)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pro-acc.vercel.app';
    const verifyUrl = `${appUrl}/verify-email?token=${verificationToken}`;
    const emailSent = await sendEmail(
      email,
      'تأكيد البريد الإلكتروني - AccWeb',
      `<div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #f9f9fb; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="font-size: 22px; color: #1a1a2e; margin: 0;">تأكيد البريد الإلكتروني</h1>
        </div>
        <p style="color: #333; font-size: 15px; line-height: 1.7;">مرحباً ${name}،</p>
        <p style="color: #333; font-size: 15px; line-height: 1.7;">شكراً لتسجيلك في <strong>AccWeb</strong>. يرجى تأكيد بريدك الإلكتروني:</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${verifyUrl}" style="display: inline-block; padding: 14px 36px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold;">تأكيد البريد</a>
        </div>
        <p style="color: #666; font-size: 13px;">هذا الرابط صالح لمدة 24 ساعة.</p>
      </div>`
    );

    const token = createToken(user.id, user.role);
    const response = success({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      company: { id: co.id, name: companyName },
      token,
      emailVerificationSent: emailSent,
      message: emailSent
        ? 'تم إنشاء الحساب. يرجى تأكيد بريدك الإلكتروني خلال 24 ساعة'
        : 'تم إنشاء الحساب بنجاح',
    }, 201);

    response.cookies.set('token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', path: '/', maxAge: 86400 * 7,
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
