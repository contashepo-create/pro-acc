import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { resetPasswordSchema } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ token: string; password: string }>(request);
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { token, password } = parsed.data;

    const tokenRes = await query(
      `SELECT id, user_id, expires_at, used
       FROM password_reset_tokens
       WHERE token = $1`,
      [token]
    );

    if (tokenRes.rows.length === 0) return error('الرمز غير صالح', 400);

    const tokenData = tokenRes.rows[0];

    if (tokenData.used) return error('تم استخدام هذا الرمز مسبقاً', 400);

    if (new Date(tokenData.expires_at) < new Date()) {
      return error('انتهت صلاحية الرمز. يرجى طلب رابط جديد', 400);
    }

    const passwordHash = await hashPassword(password);

    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      passwordHash,
      tokenData.user_id,
    ]);

    await query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [tokenData.id]);

    return success({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
