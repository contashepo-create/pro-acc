import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return error('رمز التحقق مطلوب');
    }

    const res = await query(
      `SELECT id, email FROM users
       WHERE email_verification_token = $1
         AND email_verification_expires > NOW()`,
      [token]
    );

    if (res.rows.length === 0) {
      return error('رمز التحقق غير صالح أو منتهي الصلاحية', 400);
    }

    const user = res.rows[0];

    await query(
      `UPDATE users SET email_verified = true, email_verification_token = NULL, email_verification_expires = NULL, updated_at = NOW() WHERE id = $1`,
      [user.id]
    );

    return success({ message: 'تم تأكيد البريد الإلكتروني بنجاح', email: user.email });
  } catch (err) {
    return serverError(err);
  }
}
