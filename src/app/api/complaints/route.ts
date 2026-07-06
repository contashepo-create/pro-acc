import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);

    const res = await query(
      `SELECT id, type, subject, body, status, admin_reply, created_at, updated_at
       FROM complaints WHERE company_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [companyId]
    );

    return success(res.rows);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { companyId, userId } = await requireApiAuth(request);
    const body = await parseBody<{ type: string; subject: string; body: string }>(request);

    if (!['complaint', 'suggestion'].includes(body.type)) return error('نوع غير صالح');
    if (!body.subject?.trim()) return error('العنوان مطلوب');
    if (!body.body?.trim()) return error('النص مطلوب');

    const res = await query(
      `INSERT INTO complaints (company_id, user_id, type, subject, body)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [companyId, userId, body.type, body.subject.trim(), body.body.trim()]
    );

    return success(res.rows[0], 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
