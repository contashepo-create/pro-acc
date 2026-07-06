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

    const body = await parseBody<{ companyId: string; is_active: boolean }>(request);
    if (!body.companyId || typeof body.is_active !== 'boolean') {
      return error('companyId و is_active مطلوبان');
    }

    const companyRes = await query(
      `SELECT id, name, is_active FROM companies WHERE id = $1`,
      [body.companyId]
    );

    if (companyRes.rows.length === 0) {
      return error('الشركة غير موجودة', 404);
    }

    const company = companyRes.rows[0];

    await transaction(async (client) => {
      await client.query(
        `UPDATE companies SET is_active = $1, updated_at = NOW() WHERE id = $2`,
        [body.is_active, body.companyId]
      );

      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'company', $3, $4)`,
        [
          admin.userId,
          body.is_active ? 'activate_company' : 'deactivate_company',
          body.companyId,
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
