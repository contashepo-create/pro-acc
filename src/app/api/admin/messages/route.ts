import { NextRequest } from 'next/server';
import { success, error, serverError, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    let sql = `SELECT m.id, m.subject, m.body, m.direction, m.is_read, m.created_at,
               c.name as company_name
               FROM messages m
               JOIN companies c ON c.id = m.company_id`;
    const params: any[] = [];

    if (companyId) {
      sql += ' WHERE m.company_id = $1';
      params.push(companyId);
    }

    sql += ' ORDER BY m.created_at DESC LIMIT 100';

    const res = await query(sql, params);
    return success(res.rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request);
    const body = await parseBody<{ companyId: string; subject: string; body: string }>(request);

    if (!body.companyId) return error('معرف الشركة مطلوب');
    if (!body.subject?.trim()) return error('عنوان الرسالة مطلوب');
    if (!body.body?.trim()) return error('نص الرسالة مطلوب');

    const res = await query(
      `INSERT INTO messages (company_id, admin_id, subject, body, direction)
       VALUES ($1, $2, $3, $4, 'admin_to_company') RETURNING id`,
      [body.companyId, admin.userId, body.subject.trim(), body.body.trim()]
    );

    return success({ id: res.rows[0].id }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
