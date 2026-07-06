import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound, parseBody } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { verifyAdminToken, verifyMasterPassword } from '@/lib/admin-auth';

export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const masterHeader = request.headers.get('x-master-password');
    if (!masterHeader) {
      return error('كلمة المرور الرئيسية مطلوبة في ترويسة x-master-password', 401);
    }

    const body = await parseBody<{ is_active: boolean }>(request);
    if (typeof body.is_active !== 'boolean') {
      return error('is_active يجب أن يكون true أو false');
    }

    const valid = await verifyMasterPassword(admin.userId, masterHeader);
    if (!valid) {
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    const userRes = await query(
      `SELECT id, name, email, is_active FROM users WHERE id = $1`,
      [id]
    );

    if (userRes.rows.length === 0) {
      return notFound();
    }

    const user = userRes.rows[0];

    await transaction(async (client) => {
      await client.query(
        `UPDATE users SET is_active = $1, updated_at = NOW()::timestamp WHERE id = $2`,
        [body.is_active, id]
      );

      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'user', $3, $4)`,
        [
          admin.userId,
          body.is_active ? 'activate_user' : 'deactivate_user',
          id,
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
