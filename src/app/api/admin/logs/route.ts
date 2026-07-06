import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, parseBody, getPaginationParams, getDateRangeParams } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyAdminToken, verifyMasterPassword, auditLog } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const { page, pageSize } = getPaginationParams(request.url);
    const { from, to } = getDateRangeParams(request.url);
    const search = request.nextUrl.searchParams.get('search') || '';
    const action = request.nextUrl.searchParams.get('action') || '';

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      whereClause += ` AND (action ILIKE $${paramIdx} OR details ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (action) {
      whereClause += ` AND action = $${paramIdx}`;
      params.push(action);
      paramIdx++;
    }
    if (from) {
      whereClause += ` AND created_at >= $${paramIdx}`;
      params.push(from);
      paramIdx++;
    }
    if (to) {
      whereClause += ` AND created_at <= $${paramIdx}::date + 1`;
      params.push(to);
      paramIdx++;
    }

    const countRes = await query(
      `SELECT COUNT(*)::int as total FROM admin_audit_log ${whereClause}`,
      params
    );
    const total = countRes.rows[0].total;

    params.push(pageSize, (page - 1) * pageSize);

    const res = await query(
      `SELECT id, action, details, ip_address, target_type, target_id, created_at
       FROM admin_audit_log ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    return success({
      logs: res.rows.map((row: any) => ({
        id: row.id,
        timestamp: new Date(row.created_at).toLocaleString('ar-SA'),
        action: row.action,
        details: row.details || '',
        ip: row.ip_address || '',
      })),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const body = await parseBody<{ masterPassword: string }>(request);
    if (!body.masterPassword) {
      return error('كلمة السر الرئيسية مطلوبة', 401);
    }

    const valid = await verifyMasterPassword(admin.userId, body.masterPassword);
    if (!valid) {
      return error('كلمة السر الرئيسية غير صحيحة', 401);
    }

    await query('DELETE FROM admin_audit_log');
    await auditLog(admin.userId, 'clear_logs', 'Cleared all audit logs');

    return success({ message: 'تم مسح سجل الأحداث بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
