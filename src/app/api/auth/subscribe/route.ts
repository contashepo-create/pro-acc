import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const body = await request.json();
    const { planCode } = body;

    if (!planCode) return error('planCode مطلوب');

    const s = sb();

    const { data: plan, error: planError } = await s.from('subscription_plans')
      .select('id, code, price, duration_days')
      .eq('code', planCode)
      .eq('is_active', true)
      .maybeSingle();

    if (planError || !plan) return error('الباقة غير موجودة', 404);

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const endDate = new Date(now.getTime() + plan.duration_days * 86400000).toISOString().split('T')[0];

    const { data: result, error: upsertError } = await s.from('subscriptions')
      .upsert({
        company_id: companyId,
        plan_id: plan.id,
        plan_code: plan.code,
        status: 'active',
        start_date: today,
        end_date: endDate,
        auto_renew: false,
      }, { onConflict: 'company_id' })
      .select('*')
      .single();

    if (upsertError) throw upsertError;

    if (Number(plan.price) > 0) {
      await s.from('payment_transactions').insert({
        company_id: companyId,
        subscription_id: result.id,
        amount: plan.price,
        currency: 'SAR',
        status: 'pending',
        transaction_date: today,
      });
    }

    return success({ subscription: result, plan });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
