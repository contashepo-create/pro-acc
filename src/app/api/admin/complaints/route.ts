import { NextRequest } from 'next/server';
import { success, serverError, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';

    let sql = `SELECT c.id, c.type, c.subject, c.body, c.status, c.admin_reply, c.created_at,
               co.name as company_name
               FROM complaints c
               JOIN companies co ON co.id = c.company_id`;
    const params: any[] = [];

    if (status && ['pending', 'read', 'replied', 'closed'].includes(status)) {
      sql += ' WHERE c.status = $1';
      params.push(status);
    }

    sql += ' ORDER BY c.created_at DESC LIMIT 100';

    const res = await query(sql, params);
    return success(res.rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request);
    const body = await parseBody<{ id: string; status?: string; adminReply?: string }>(request);

    if (body.status && !['pending', 'read', 'replied', 'closed'].includes(body.status)) {
      return success({ message: 'حالة غير صالحة' }, 400);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (body.status) {
      updates.push(`status = $${idx++}`);
      params.push(body.status);
    }

    if (body.adminReply !== undefined) {
      updates.push(`admin_reply = $${idx++}`);
      updates.push(`replied_by = $${idx++}`);
      updates.push(`replied_at = NOW()`);
      params.push(body.adminReply);
      params.push(admin.userId);
    }

    if (updates.length === 0) return success({ message: 'لا توجد تحديثات' });

    updates.push(`updated_at = NOW()`);
    params.push(body.id);

    await query(
      `UPDATE complaints SET ${updates.join(', ')} WHERE id = $${idx}`,
      params
    );

    return success({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
