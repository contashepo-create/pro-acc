import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await query(
      `SELECT s.*, c.name as company_name, p.name as plan_name, p.price_monthly
       FROM subscriptions s
       LEFT JOIN companies c ON c.id = s.company_id
       LEFT JOIN subscription_plans p ON p.id = s.plan_id
       WHERE s.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return error('Not found', 404);
    const payments = await query(
      'SELECT * FROM payment_transactions WHERE subscription_id = $1 ORDER BY transaction_date DESC',
      [id]
    );
    return success({ ...result.rows[0], payments: payments.rows });
  } catch (e: any) {
    return serverError(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseBody(req);
    const result = await query(
      `UPDATE subscriptions SET status = COALESCE($1, status), end_date = COALESCE($2, end_date),
       auto_renew = COALESCE($3, auto_renew) WHERE id = $4 RETURNING *`,
      [body.status, body.endDate, body.autoRenew, id]
    );
    if (result.rows.length === 0) return error('Not found', 404);
    return success(result.rows[0]);
  } catch (e: any) {
    return serverError(e);
  }
}
