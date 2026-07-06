import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseBody(req);
    const result = await query(
      `UPDATE subscription_plans SET code = COALESCE($1, code), name = COALESCE($2, name),
       description = COALESCE($3, description), price_monthly = COALESCE($4, price_monthly),
       price_yearly = COALESCE($5, price_yearly), max_users = COALESCE($6, max_users),
       max_projects = COALESCE($7, max_projects), is_active = COALESCE($8, is_active)
       WHERE id = $9 RETURNING *`,
      [body.code, body.name, body.description, body.priceMonthly, body.priceYearly, body.maxUsers, body.maxProjects, body.isActive, id]
    );
    if (result.rows.length === 0) return error('Not found', 404);
    return success(result.rows[0]);
  } catch (e: any) {
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deps = await query('SELECT id FROM subscriptions WHERE plan_id = $1 LIMIT 1', [id]);
    if (deps.rows.length > 0) return error('Cannot delete: plan has active subscriptions');
    const result = await query('DELETE FROM subscription_plans WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return error('Not found', 404);
    return success({ deleted: true });
  } catch (e: any) {
    return serverError(e);
  }
}
