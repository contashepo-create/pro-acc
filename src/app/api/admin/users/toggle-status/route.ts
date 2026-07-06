import { NextRequest } from 'next/server';
import { success, unauthorized, error, serverError, parseBody } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { verifyAdminToken, verifyMasterPassword } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const masterHeader = request.headers.get('x-master-password');
    if (!masterHeader) {
      return error('كلمة المرور الرئيسية مطلوبة في ترويسة x-master-password', 401);
    }

    const valid = await verifyMasterPassword(admin.userId, masterHeader);
    if (!valid) {
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    const body = await parseBody<{ userId: string; is_active: boolean }>(request);
    if (!body.userId || typeof body.is_active !== 'boolean') {
      return error('userId و is_active مطلوبان');
    }

    const userRes = await query(
      `SELECT id, name, email, is_active FROM users WHERE id = $1`,
      [body.userId]
    );

    if (userRes.rows.length === 0) {
      return error('المستخدم غير موجود', 404);
    }

    const user = userRes.rows[0];

    await transaction(async (client) => {
      await client.query(
        `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`,
        [body.is_active, body.userId]
      );

      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'user', $3, $4)`,
        [
          admin.userId,
          body.is_active ? 'activate_user' : 'deactivate_user',
          body.userId,
          JSON.stringify({ userName: user.name, userEmail: user.email, previousState: user.is_active }),
        ]
      );
    });

    return success({
      message: body.is_active ? 'تم تفعيل المستخدم بنجاح' : 'تم إيقاف المستخدم بنجاح',
    });
  } catch (err) {
    return serverError(err);
  }
}
