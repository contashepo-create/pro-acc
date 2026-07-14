import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const s = sb();

    const { data: plans } = await s.from('subscription_plans')
      .select('id, code, name, description, duration_days, price, currency, is_active')
      .eq('is_active', true)
      .order('price', { ascending: true });

    const { data: subscription } = await s.from('subscriptions')
      .select('id, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew, subscription_plans(name, price, duration_days)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let subData = null;
    if (subscription) {
      subData = {
        ...subscription,
        plan_name: (subscription as Record<string, any>).subscription_plans?.name || null,
        price: (subscription as Record<string, any>).subscription_plans?.price || null,
        duration_days: (subscription as Record<string, any>).subscription_plans?.duration_days || null,
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
