import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');
    const result = await query(
      'SELECT * FROM notifications WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2',
      [auth.companyId, limit]
    );
    return success(result.rows);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const { type, title, message, link } = await parseBody(req);
    if (!auth.companyId || !type || !title || !message) {
      return error('companyId, type, title, message are required');
    }
    const result = await query(
      `INSERT INTO notifications (company_id, user_id, type, title, message, link)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [auth.companyId, auth.userId, type, title, message, link || null]
    );
    return success(result.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}
