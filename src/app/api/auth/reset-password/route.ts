import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword } from '@/lib/auth';
import { resetPasswordSchema } from '@/lib/validation';
import { createHash } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const parsed = resetPasswordSchema.safeParse(await parseBody<{ token: string; password: string }>(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex');
    const passwordHash = await hashPassword(parsed.data.password);
    // Token lock/consumption, password update, session-version bump and all-link
    // revocation commit together. Two concurrent requests cannot both win.
    const { error: resetErr } = await getSupabase().rpc('consume_password_reset_token', {
      p_token_hash: tokenHash,
      p_password_hash: passwordHash,
    });
    if (resetErr) {
      const message = String(resetErr.message || '');
      if (resetErr.code === 'P0001' || message.includes('الرمز') || message.includes('المستخدم')) {
        return error(message.includes('انتهت') ? 'انتهت صلاحية الرمز. يرجى طلب رابط جديد' : 'الرمز غير صالح أو مستخدم', 400);
      }
      throw resetErr;
    }
    return success({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
