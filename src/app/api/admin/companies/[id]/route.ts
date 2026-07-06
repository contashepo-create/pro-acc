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

    const companyRes = await query(
      `SELECT id, name, is_active FROM companies WHERE id = $1`,
      [id]
    );

    if (companyRes.rows.length === 0) {
      return notFound();
    }

    const company = companyRes.rows[0];

    await transaction(async (client) => {
      await client.query(
        `UPDATE companies SET is_active = $1, updated_at = NOW()::timestamp WHERE id = $2`,
        [body.is_active, id]
      );

      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'company', $3, $4)`,
        [
          admin.userId,
          body.is_active ? 'activate_company' : 'deactivate_company',
          id,
          JSON.stringify({ companyName: company.name, previousState: company.is_active }),
        ]
      );
    });

    return success({
      message: body.is_active ? 'تم تفعيل الشركة بنجاح' : 'تم إيقاف الشركة بنجاح',
    });
  } catch (err) {
    return serverError(err);
  }
}
