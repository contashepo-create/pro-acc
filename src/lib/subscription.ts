import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

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
  const s = sb();

  const { data: sub, error } = await s.from('subscriptions')
    .select('id, company_id, plan_id, plan_code, status, start_date, end_date, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !sub) return null;

  // Get plan name separately
  let planName: string | null = null;
  if (sub.plan_id) {
    const { data: plan } = await s.from('subscription_plans')
      .select('name')
      .eq('id', sub.plan_id)
      .single();
    if (plan) planName = plan.name;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(sub.end_date);
  const diffTime = endDate.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return {
    id: sub.id,
    company_id: sub.company_id,
    plan_code: sub.plan_code,
    plan_name: planName,
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
