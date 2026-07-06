import { query } from '@/lib/db';

export interface SubscriptionInfo {
  id: string;
  company_id: string;
  plan_code: string;
  plan_name: string | null;
  status: string;
  start_date: string;
  end_date: string;
  days_remaining: number;
  is_expired: boolean;
  is_expiring_soon: boolean;
}

export async function getCompanySubscription(companyId: string): Promise<SubscriptionInfo | null> {
  const res = await query(
    `SELECT s.*, sp.name as plan_name
     FROM subscriptions s
     LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.company_id = $1
     ORDER BY s.created_at DESC LIMIT 1`,
    [companyId]
  );

  if (res.rows.length === 0) return null;

  const sub = res.rows[0];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(sub.end_date);
  const diffTime = endDate.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return {
    id: sub.id,
    company_id: sub.company_id,
    plan_code: sub.plan_code,
    plan_name: sub.plan_name,
    status: sub.status,
    start_date: sub.start_date,
    end_date: sub.end_date,
    days_remaining: daysRemaining,
    is_expired: daysRemaining <= 0,
    is_expiring_soon: daysRemaining > 0 && daysRemaining <= 7,
  };
}

export async function requireActiveSubscription(companyId: string): Promise<void> {
  const sub = await getCompanySubscription(companyId);
  if (!sub) throw new SubscriptionError('لا يوجد اشتراك فعال');
  if (sub.is_expired) throw new SubscriptionError('انتهت صلاحية الاشتراك. يرجى تجديد الاشتراك');
}

export class SubscriptionError extends Error {
  constructor(message: string) { super(message); this.name = 'SubscriptionError'; }
}
