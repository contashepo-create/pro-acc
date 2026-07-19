import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const { companyId, userId } = await requireApiAuth(request);
    const s = sb();

    const { data: plans } = await s.from('subscription_plans')
      .select('id, code, name, description, duration_days, price, currency, is_active, max_users, price_monthly, price_yearly, yearly_discount_percent, trial_days')
      .eq('is_active', true)
      .order('price', { ascending: true });

    const { data: subscription } = await s.from('subscriptions')
      .select('id, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew, subscription_plans(name, price, duration_days)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let subData: any = null;
    if (subscription) {
      const sub = subscription as Record<string, any>;
      
      // حساب الأيام المتبقية بشكل صحيح
      let daysRemaining = 0;
      let isExpired = false;
      let isExpiringSoon = false;
      
      if (sub.end_date) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endDate = new Date(sub.end_date);
        const diffTime = endDate.getTime() - today.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isExpired = daysRemaining <= 0;
        isExpiringSoon = daysRemaining > 0 && daysRemaining <= 7;
      }

      subData = {
        id: sub.id,
        plan_id: sub.plan_id,
        plan_code: sub.plan_code,
        plan_name: sub.subscription_plans?.name || null,
        status: sub.status,
        start_date: sub.start_date,
        end_date: sub.end_date,
        trial_end_date: sub.trial_end_date,
        auto_renew: sub.auto_renew,
        days_remaining: daysRemaining,
        is_expired: isExpired,
        is_expiring_soon: isExpiringSoon,
      };
    }

    return success({
      plans: plans || [],
      subscription: subData,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
