import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const body = await parseBody(req);
    const result = await query(
      `UPDATE notifications SET is_read = COALESCE($1, is_read) WHERE id = $2 RETURNING *`,
      [body.isRead ?? true, id]
    );
    if (result.rows.length === 0) return error('Not found', 404);
    return success(result.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const result = await query('DELETE FROM notifications WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return error('Not found', 404);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
