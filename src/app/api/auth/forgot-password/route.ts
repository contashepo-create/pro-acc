import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { forgotPasswordSchema } from '@/lib/validation';
import { randomBytes } from 'crypto';
import { sendPasswordResetEmail } from '@/lib/email';

// @ts-ignore
const sb = () => getSupabase() as any;

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
      return success({ message: 'إذا كان البريد الإلكتروني مسجلاً، ستتلقى رابط إعادة التعيين' });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    await s.from('password_reset_tokens').insert({
      user_id: user.id,
      token,
      expires_at: expiresAt,
    });

    const resetUrl = `${request.nextUrl.origin}/reset-password?token=${token}`;

    const emailSent = await sendPasswordResetEmail(email, resetUrl);

    if (!emailSent && process.env.NODE_ENV !== 'production') {
      return success({
        message: 'رابط إعادة تعيين كلمة المرور جاهز',
        resetUrl,
        email: user.email,
      });
    }

    return success({ message: 'تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني' });
  } catch (err) {
    return serverError(err);
  }
}
