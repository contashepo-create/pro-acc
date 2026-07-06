import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, parseBody } from '@/lib/api-helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sheet = await query('SELECT * FROM salary_sheets WHERE id = $1', [id]);
    if (sheet.rows.length === 0) return error('Not found', 404);
    const items = await query(
      `SELECT si.*, e.name as employee_name
       FROM salary_items si
       LEFT JOIN employees e ON e.id = si.employee_id
       WHERE si.sheet_id = $1`,
      [id]
    );
    return success({ ...sheet.rows[0], items: items.rows });
  } catch (e: any) {
    return error(e.message);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseBody(req);
    const result = await query(
      `UPDATE salary_sheets SET name = COALESCE($1, name), status = COALESCE($2, status)
       WHERE id = $3 RETURNING *`,
      [body.name, body.status, id]
    );
    if (result.rows.length === 0) return error('Not found', 404);
    return success(result.rows[0]);
  } catch (e: any) {
    return error(e.message);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await query('DELETE FROM salary_items WHERE sheet_id = $1', [id]);
    const result = await query('DELETE FROM salary_sheets WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return error('Not found', 404);
    return success({ deleted: true });
  } catch (e: any) {
    return error(e.message);
  }
}
