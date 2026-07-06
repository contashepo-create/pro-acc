import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const body = await request.json();
    const { planCode } = body;

    if (!planCode) return error('planCode مطلوب');

    const planRes = await query(
      'SELECT id, code, price, duration_days FROM subscription_plans WHERE code = $1 AND is_active = true',
      [planCode]
    );
    if (planRes.rows.length === 0) return error('الباقة غير موجودة', 404);

    const plan = planRes.rows[0];

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const endDate = new Date(now.getTime() + plan.duration_days * 86400000).toISOString().split('T')[0];

    const result = await query(
      `INSERT INTO subscriptions (company_id, plan_id, plan_code, status, start_date, end_date, auto_renew)
       VALUES ($1, $2, $3, 'active', $4, $5, false)
       ON CONFLICT (company_id) DO UPDATE SET plan_id = $2, plan_code = $3, status = 'active', start_date = $4, end_date = $5, auto_renew = false
       RETURNING *`,
      [companyId, plan.id, plan.code, today, endDate]
    );

    if (Number(plan.price) > 0) {
      await query(
        `INSERT INTO payment_transactions (company_id, subscription_id, amount, currency, status, transaction_date)
         VALUES ($1, $2, $3, 'SAR', 'pending', $4)`,
        [companyId, result.rows[0].id, plan.price, today]
      );
    }

    return success({ subscription: result.rows[0], plan });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
