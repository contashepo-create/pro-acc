import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, parseBody } from '@/lib/api-helpers';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseBody(req);
    const result = await query(
      `UPDATE currencies SET code = COALESCE($1, code), name = COALESCE($2, name),
       rate = COALESCE($3, rate), is_base = COALESCE($4, is_base)
       WHERE id = $5 RETURNING *`,
      [body.code, body.name, body.rate, body.isBase, id]
    );
    if (result.rows.length === 0) return error('Currency not found', 404);
    return success(result.rows[0]);
  } catch (e: any) {
    return error(e.message);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query('DELETE FROM currencies WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return error('Currency not found', 404);
    return success({ deleted: true });
  } catch (e: any) {
    return error(e.message);
  }
}
