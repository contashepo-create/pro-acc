import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, parseBody } from '@/lib/api-helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rec = await query('SELECT * FROM bank_reconciliation WHERE id = $1', [id]);
    if (rec.rows.length === 0) return error('Not found', 404);
    const items = await query(
      'SELECT * FROM bank_reconciliation_items WHERE reconciliation_id = $1 ORDER BY date',
      [id]
    );
    return success({ ...rec.rows[0], items: items.rows });
  } catch (e: any) {
    return error(e.message);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseBody(req);
    const result = await query(
      `UPDATE bank_reconciliation SET closing_balance = COALESCE($1, closing_balance),
       status = COALESCE($2, status) WHERE id = $3 RETURNING *`,
      [body.closingBalance, body.status, id]
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
    await query('DELETE FROM bank_reconciliation_items WHERE reconciliation_id = $1', [id]);
    const result = await query('DELETE FROM bank_reconciliation WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return error('Not found', 404);
    return success({ deleted: true });
  } catch (e: any) {
    return error(e.message);
  }
}
