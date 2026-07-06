import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);

    const plansRes = await query(
      `SELECT id, code, name, description, duration_days, price, currency, is_active
       FROM subscription_plans WHERE is_active = true ORDER BY price ASC`
    );

    const subRes = await query(
      `SELECT s.id, s.plan_id, s.plan_code, s.status, s.start_date, s.end_date, s.trial_end_date, s.auto_renew,
              sp.name as plan_name, sp.price, sp.duration_days
       FROM subscriptions s
       LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
       WHERE s.company_id = $1
       ORDER BY s.created_at DESC LIMIT 1`,
      [companyId]
    );

    return success({
      plans: plansRes.rows,
      subscription: subRes.rows[0] || null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
