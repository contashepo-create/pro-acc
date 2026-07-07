import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { hashPassword, createToken } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { randomBytes } from 'crypto';
import { sendEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{
      companyName: string;
      name: string;
      email: string;
      password: string;
      phone?: string;
    }>(request);

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { companyName, name, email, password, phone } = parsed.data;

    const existing = await query('SELECT id FROM users WHERE email = LOWER($1)', [email]);
    if (existing.rows.length > 0) return error('البريد الإلكتروني مسجل مسبقاً', 409);

    const companyCheck = await query('SELECT id FROM companies WHERE name = $1', [companyName]);
    if (companyCheck.rows.length > 0) return error('اسم الشركة موجود مسبقاً', 409);

    const passwordHash = await hashPassword(password);
    const verificationToken = randomBytes(32).toString('hex');

    const companyRes = await query(
      `INSERT INTO companies (id, name, email, phone, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, LOWER($2), $3, NOW(), NOW()) RETURNING id`,
      [companyName, email, phone || null]
    );
    const companyId = companyRes.rows[0].id;

    const userRes = await query(
      `INSERT INTO users (id, company_id, name, email, password_hash, role, is_active, email_verified, email_verification_token, email_verification_expires, last_activity, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, LOWER($3), $4, 'admin', true, false, $5, NOW() + INTERVAL '24 hours', NOW(), NOW(), NOW()) RETURNING id, name, email, role`,
      [companyId, name, email, passwordHash, verificationToken]
    );
    const user = userRes.rows[0];

    await query(
      `INSERT INTO subscription_plans (code, name, duration_days, price, currency, is_active)
       VALUES ('trial', 'تجريبي', 30, 0, 'SAR', true)
       ON CONFLICT (code) DO NOTHING`
    );

    const planRes = await query(
      `SELECT id FROM subscription_plans WHERE code = 'trial' AND is_active = true LIMIT 1`
    );

    if (planRes.rows.length > 0) {
      const planId = planRes.rows[0].id;
      await query(
        `INSERT INTO subscriptions (company_id, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew)
         VALUES ($1, $2, 'trial', 'trial', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE + INTERVAL '30 days', false)
         ON CONFLICT (company_id) DO NOTHING`,
        [companyId, planId]
      );
    }

    // Send verification email
    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://pro-acc.vercel.app'}/verify-email?token=${verificationToken}`;
    const emailHtml = `
      <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #f9f9fb; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="font-size: 22px; color: #1a1a2e; margin: 0;">تأكيد البريد الإلكتروني</h1>
        </div>
        <p style="color: #333; font-size: 15px; line-height: 1.7;">مرحباً ${name}،</p>
        <p style="color: #333; font-size: 15px; line-height: 1.7;">شكراً لتسجيلك في <strong>AccWeb</strong>. يرجى تأكيد بريدك الإلكتروني بالضغط على الزر أدناه:</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${verifyUrl}" style="display: inline-block; padding: 14px 36px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 15px;">تأكيد البريد الإلكتروني</a>
        </div>
        <p style="color: #666; font-size: 13px; line-height: 1.6;">هذا الرابط صالح لمدة 24 ساعة. إذا لم تطلب التسجيل، يمكنك تجاهل هذا البريد.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #999; font-size: 11px; text-align: center;">AccWeb © ${new Date().getFullYear()} — نظام محاسبة متكامل</p>
      </div>`;
    await sendEmail(email, 'تأكيد البريد الإلكتروني - AccWeb', emailHtml);

    const token = createToken(user.id, user.role);

    const response = success({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      company: { id: companyId, name: companyName },
      token,
      message: 'تم إنشاء الحساب. يرجى تأكيد بريدك الإلكتروني خلال 24 ساعة',
    }, 201);

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 86400 * 7,
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
