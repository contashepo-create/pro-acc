import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = 50;
    const offset = (page - 1) * limit;

    const countRes = await query(
      'SELECT COUNT(*) FROM messages WHERE company_id = $1',
      [companyId]
    );
    const total = parseInt(countRes.rows[0].count);

    const res = await query(
      `SELECT id, subject, body, direction, is_read, created_at
       FROM messages WHERE company_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [companyId, limit, offset]
    );

    return success({ messages: res.rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { companyId, userId } = await requireApiAuth(request);
    const body = await parseBody<{ subject: string; body: string }>(request);

    if (!body.subject?.trim()) return error('عنوان الرسالة مطلوب');
    if (!body.body?.trim()) return error('نص الرسالة مطلوب');

    const res = await query(
      `INSERT INTO messages (company_id, subject, body, direction)
       VALUES ($1, $2, $3, 'company_to_admin') RETURNING id, created_at`,
      [companyId, body.subject.trim(), body.body.trim()]
    );

    return success({ message: res.rows[0] }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
