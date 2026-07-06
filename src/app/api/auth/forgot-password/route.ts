import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { forgotPasswordSchema } from '@/lib/validation';
import { createHmac, randomBytes } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string }>(request);
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { email } = parsed.data;

    const userRes = await query(
      'SELECT id, name, email FROM users WHERE email = LOWER($1) AND is_active = true',
      [email]
    );

    if (userRes.rows.length === 0) {
      return success({ message: 'إذا كان البريد الإلكتروني مسجلاً، ستتلقى رابط إعادة التعيين' });
    }

    const user = userRes.rows[0];
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    );

    return success({
      message: 'رابط إعادة تعيين كلمة المرور جاهز',
      resetUrl: `${request.nextUrl.origin}/reset-password?token=${token}`,
      email: user.email,
    });
  } catch (err) {
    return serverError(err);
  }
}
