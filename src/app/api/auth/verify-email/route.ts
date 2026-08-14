import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createHash } from 'crypto';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return error('رمز التحقق مطلوب');
    }

    if (typeof token !== 'string' || token.length !== 64 || !/^[a-f0-9]+$/i.test(token)) {
      return error('رمز التحقق غير صالح أو منتهي الصلاحية', 400);
    }

    const s = sb();
    const now = new Date().toISOString();
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const { data: user, error: queryError } = await s.from('users')
      .select('id, email')
      .eq('email_verification_token', tokenHash)
      .gt('email_verification_expires', now)
      .maybeSingle();

    if (queryError || !user) {
      return error('رمز التحقق غير صالح أو منتهي الصلاحية', 400);
    }

    await s.from('users')
      .update({
        email_verified: true,
        email_verification_token: null,
        email_verification_expires: null,
        updated_at: now,
      })
      .eq('id', user.id);

    return success({ message: 'تم تأكيد البريد الإلكتروني بنجاح', email: user.email });
  } catch (err) {
    return serverError(err);
  }
}
