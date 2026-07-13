import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword } from '@/lib/auth';
import { resetPasswordSchema } from '@/lib/validation';
import { createHash } from 'crypto';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ token: string; password: string }>(request);
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { token, password } = parsed.data;
    const s = sb();

    // Hash incoming token to match stored hash
    const hashedToken = createHash('sha256').update(token).digest('hex');

    // Try both hashed and plain for backward compatibility during migration
    let tokenData = null;
    let tokenError = null;

    // First try hashed
    const { data: hashedData, error: hashedErr } = await s.from('password_reset_tokens')
      .select('id, user_id, expires_at, used')
      .eq('token', hashedToken)
      .maybeSingle();

    if (hashedData) {
      tokenData = hashedData;
    } else {
      // Fallback to plain (for tokens created before fix)
      const { data: plainData, error: plainErr } = await s.from('password_reset_tokens')
        .select('id, user_id, expires_at, used')
        .eq('token', token)
        .maybeSingle();
      tokenData = plainData;
      tokenError = plainErr;
      if (hashedErr && plainErr) tokenError = hashedErr;
    }

    if (tokenError || !tokenData) return error('الرمز غير صالح', 400);

    if (tokenData.used) return error('تم استخدام هذا الرمز مسبقاً', 400);

    if (new Date(tokenData.expires_at) < new Date()) {
      return error('انتهت صلاحية الرمز. يرجى طلب رابط جديد', 400);
    }

    const passwordHash = await hashPassword(password);

    await s.from('users')
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq('id', tokenData.user_id);

    await s.from('password_reset_tokens')
      .update({ used: true })
      .eq('id', tokenData.id);

    return success({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
