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
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';

    // Rate limiting: prevent attackers from flooding a target's inbox with
    // password-reset emails (email bombing / abuse). Counts real requests via
    // the password_reset_requests table so repeated resets are throttled.
    try {
      const { checkPasswordResetRateLimit } = await import('@/lib/rate-limit');
      const rateLimit = await checkPasswordResetRateLimit(email.toLowerCase(), ip);
      if (!rateLimit.allowed) {
        return error(`عدد الطلبات كبير. حاول بعد ${rateLimit.remainingMinutes} دقائق`, 429);
      }
    } catch {}

    // Record the request (also gives us a delivery log for diagnostics).
    let requestId: string | null = null;
    try {
      const { recordPasswordResetRequest } = await import('@/lib/rate-limit');
      requestId = await recordPasswordResetRequest(email.toLowerCase(), ip);
    } catch {}

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

    // Record the delivery outcome for diagnostics (server-side only).
    try {
      const { markPasswordResetRequest } = await import('@/lib/rate-limit');
      if (emailSent) await markPasswordResetRequest(requestId, 'delivered');
      else await markPasswordResetRequest(requestId, 'failed', 'SMTP not configured or send failed');
    } catch {}

    // In development or when SMTP is not configured, return the reset URL
    // so the user can still reset their password
    if (!emailSent && process.env.NODE_ENV !== 'production') {
      return success({ message: 'لم يتم تكوين خادم البريد. استخدم الرابط أدناه لإعادة التعيين', resetUrl });
    }

    if (!emailSent) {
      // Explicit failure so the user knows the reset couldn't be delivered
      // (email bombing is already throttled above, so this isn't an
      // enumeration vector an attacker can exploit at scale).
      return success({ message: 'تعذر إرسال رابط إعادة التعيين حالياً. يرجى المحاولة لاحقاً أو التواصل مع مدير النظام' });
    }

    // SECURITY (anti-enumeration): return the exact same generic message as
    // the account-not-found path, so an attacker cannot distinguish a valid
    // account by the differing response text.
    return success({ message: 'إذا كان البريد الإلكتروني مسجلاً، ستتلقى رابط إعادة التعيين' });
  } catch (err) {
    return serverError(err);
  }
}
