import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { forgotPasswordSchema } from '@/lib/validation';
import { randomBytes, createHash } from 'crypto';
import { sendPasswordResetEmail } from '@/lib/email';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string }>(request);
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { email } = parsed.data;
    const s = sb();

    const { data: user, error: queryError } = await s.from('users')
      .select('id, name, email')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .maybeSingle();

    if (queryError || !user) {
      // Always return same message to prevent email enumeration
      return success({ message: 'إذا كان البريد الإلكتروني مسجلاً، ستتلقى رابط إعادة التعيين' });
    }

    const rawToken = randomBytes(32).toString('hex');
    // Hash token before storing (security best practice)
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    await s.from('password_reset_tokens').insert({
      user_id: user.id,
      token: hashedToken,
      expires_at: expiresAt,
    });

    const resetUrl = `${request.nextUrl.origin}/reset-password?token=${rawToken}`;

    const emailSent = await sendPasswordResetEmail(email, resetUrl);

    // In development or when SMTP is not configured, return the reset URL
    // so the user can still reset their password
    if (!emailSent && process.env.NODE_ENV !== 'production') {
      return success({ message: 'لم يتم تكوين خادم البريد. استخدم الرابط أدناه لإعادة التعيين', resetUrl });
    }

    if (!emailSent) {
      return success({ message: 'تعذر إرسال البريد الإلكتروني. تواصل مع مدير النظام' });
    }

    return success({ message: 'تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني' });
  } catch (err) {
    return serverError(err);
  }
}
