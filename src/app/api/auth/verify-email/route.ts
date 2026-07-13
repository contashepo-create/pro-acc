import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return error('رمز التحقق مطلوب');
    }

    const s = sb();
    const now = new Date().toISOString();

    const { data: user, error: queryError } = await s.from('users')
      .select('id, email')
      .eq('email_verification_token', token)
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
