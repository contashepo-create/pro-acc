import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { resendVerificationSchema } from '@/lib/validation';
import { randomBytes, createHash } from 'crypto';
import { sendEmail } from '@/lib/email';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string }>(request);
    const parsed = resendVerificationSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { email } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();
    const s = sb();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';

    // Rate limiting: prevent attackers from flooding inboxes with
    // verification emails (email bombing). Counts real requests via the
    // password_reset_requests table so repeated resends are throttled.
    try {
      const { checkPasswordResetRateLimit } = await import('@/lib/rate-limit');
      const rateLimit = await checkPasswordResetRateLimit(normalizedEmail, ip);
      if (!rateLimit.allowed) {
        return error(`عدد الطلبات كبير. حاول بعد ${rateLimit.remainingMinutes} دقائق`, 429);
      }
    } catch {}

    // Record the request for throttling + delivery diagnostics.
    let requestId: string | null = null;
    try {
      const { recordPasswordResetRequest } = await import('@/lib/rate-limit');
      requestId = await recordPasswordResetRequest(normalizedEmail, ip);
    } catch {}

    const { data: user } = await s.from('users')
      .select('id, name, email_verified, is_active')
      .eq('email', normalizedEmail)
      .maybeSingle();

    // Generic message to avoid leaking whether an account exists.
    const genericMsg = 'إذا كان البريد الإلكتروني مسجلاً وغير مؤكد، سنرسل رابط التأكيد';

    if (!user || !(user as Record<string, any>).is_active) {
      return success({ message: genericMsg });
    }
    const u = user as Record<string, any>;
    if (u.email_verified === true) {
      return success({ message: 'تم تأكيد هذا البريد الإلكتروني مسبقاً' });
    }

    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenHash = createHash('sha256').update(verificationToken).digest('hex');
    await s.from('users')
      .update({
        email_verification_token: verificationTokenHash,
        email_verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', u.id);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pro-acc.vercel.app';
    const verifyUrl = `${appUrl}/verify-email?token=${verificationToken}`;
    const safeName = String(u.name || '')
      .replace(/[&<>"']/g, (m: string) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] as string));

    const emailSent = await sendEmail(
      normalizedEmail,
      'تأكيد البريد الإلكتروني - AccWeb',
      `<div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #f9f9fb; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="font-size: 22px; color: #1a1a2e; margin: 0;">تأكيد البريد الإلكتروني</h1>
        </div>
        <p style="color: #333; font-size: 15px; line-height: 1.7;">مرحباً ${safeName}،</p>
        <p style="color: #333; font-size: 15px; line-height: 1.7;">استلمنا طلباً لإعادة إرسال رابط تأكيد بريدك الإلكتروني في <strong>AccWeb</strong>.</p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${verifyUrl}" style="display: inline-block; padding: 14px 36px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 10px; font-weight: bold;">تأكيد البريد</a>
        </div>
        <p style="color: #666; font-size: 13px;">هذا الرابط صالح لمدة 24 ساعة.</p>
      </div>`
    );

    // Record delivery outcome for diagnostics.
    try {
      const { markPasswordResetRequest } = await import('@/lib/rate-limit');
      if (emailSent) await markPasswordResetRequest(requestId, 'delivered');
      else await markPasswordResetRequest(requestId, 'failed', 'SMTP not configured or send failed');
    } catch {}

    if (!emailSent && process.env.NODE_ENV !== 'production') {
      return success({ message: 'لم يتم تكوين خادم البريد. استخدم الرابط أدناه', resetUrl: verifyUrl });
    }
    if (!emailSent) {
      return success({ message: 'تعذر إرسال رابط التأكيد حالياً. يرجى المحاولة لاحقاً أو التواصل مع مدير النظام' });
    }

    return success({ message: 'تم إرسال رابط التأكيد إلى بريدك الإلكتروني' });
  } catch (err) {
    return serverError(err);
  }
}
