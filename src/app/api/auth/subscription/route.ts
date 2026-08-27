import { NextRequest } from 'next/server';
import { success, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const s = sb();

    const { data: plans } = await s.from('subscription_plans')
      .select(`id, code, name, description_ar, currency, is_active,
               max_users, price_monthly, price_yearly,
               yearly_discount_percent, trial_days,
               max_invoices_per_month, max_quotations_per_month,
               max_storage_mb, features_modules`)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('price_monthly', { ascending: true });

    const { data: subscription } = await s.from('subscriptions')
      .select(`id, subscriber_number, plan_id, plan_code, status,
               start_date, end_date, trial_end_date, auto_renew,
               extra_users, extra_branches, extra_storage_gb, addons_json,
               subscription_plans(name, price_monthly, price_yearly, currency,
                                  max_invoices_per_month, max_quotations_per_month,
                                  max_storage_mb, features_modules)`)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let subData: unknown = null;
    if (subscription) {
      const sub = subscription as Row;
      let daysRemaining = 0;
      let isExpired = false;
      let isExpiringSoon = false;

      if (sub.end_date) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endDate = new Date(String(sub.end_date));
        const diffTime = endDate.getTime() - today.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isExpired = daysRemaining <= 0 || sub.status === 'pending' || sub.status === 'cancelled';
        isExpiringSoon = !isExpired && daysRemaining > 0 && daysRemaining <= 7;
      }

      // Effective limits = plan base + add-ons
      const plan = sub.subscription_plans as Row | null;
      const extraStorageGb = Number(sub.extra_storage_gb || 0);
      subData = {
        id: sub.id,
        subscriber_number: sub.subscriber_number || null,
        plan_id: sub.plan_id,
        plan_code: sub.plan_code,
        plan_name: plan?.name || null,
        status: sub.status,
        start_date: sub.start_date,
        end_date: sub.end_date,
        trial_end_date: sub.trial_end_date,
        auto_renew: sub.auto_renew,
        days_remaining: daysRemaining,
        is_expired: isExpired,
        is_expiring_soon: isExpiringSoon,
        currency: plan?.currency || 'USD',
        price_monthly: plan?.price_monthly ?? null,
        price_yearly: plan?.price_yearly ?? null,
        extra_users: Number(sub.extra_users || 0),
        extra_branches: Number(sub.extra_branches || 0),
        extra_storage_gb: extraStorageGb,
        addons: sub.addons_json || {},
        limits: plan ? {
          max_users: (Number(plan.max_users) || 1) + Number(sub.extra_users || 0),
          max_invoices_per_month: plan.max_invoices_per_month,
          max_quotations_per_month: plan.max_quotations_per_month,
          max_storage_mb: Number(plan.max_storage_mb || 0) + extraStorageGb * 1024,
        } : null,
      };
    }

    return success({
      plans: plans || [],
      subscription: subData,
      addons: {
        extra_user_monthly_usd: 5,
        extra_user_yearly_usd: 48,
        extra_branch_monthly_usd: 10,
        extra_branch_yearly_usd: 96,
        storage_gb_monthly_usd: 3,
        storage_gb_yearly_usd: 30,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

