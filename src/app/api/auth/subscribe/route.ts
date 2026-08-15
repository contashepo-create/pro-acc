import { NextRequest } from 'next/server';
import { success, error, parseValidatedBody, requireAdmin, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { z } from 'zod';

const sb = () => getSupabase();
const subscribeSchema = z.object({ planCode: z.string().trim().min(1).max(64) }).strict();

/**
 * Starts a subscription checkout request. This endpoint must not activate a
 * paid plan: payment confirmation is the sole authority for activation.
 */
export async function POST(request: NextRequest) {
  try {
    const { companyId } = await requireAdmin(request);
    const body = await parseValidatedBody(request, subscribeSchema);
    const { planCode } = body as z.infer<typeof subscribeSchema>;
    const s = sb();

    const { data: plan, error: planError } = await s.from('subscription_plans')
      .select('id, code, price, duration_days')
      .eq('code', planCode)
      .eq('is_active', true)
      .maybeSingle();
    if (planError || !plan) return error('الباقة غير موجودة', 404);

    const price = Number(plan.price || 0);
    const durationDays = Number(plan.duration_days || 0);
    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(durationDays) || durationDays < 1) {
      return error('إعدادات الباقة غير صالحة', 400);
    }

    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + durationDays * 86400000).toISOString().split('T')[0];
    // Only a genuinely free plan can be activated immediately. A priced plan
    // remains pending until the payment webhook/service confirms success.
    const status = price === 0 ? 'active' : 'pending';
    const { data: result, error: upsertError } = await s.from('subscriptions')
      .upsert({
        company_id: companyId,
        plan_id: plan.id,
        plan_code: plan.code,
        status,
        start_date: today,
        end_date: endDate,
        auto_renew: false,
      }, { onConflict: 'company_id' })
      .select('*')
      .single();
    if (upsertError) throw upsertError;

    if (price > 0) {
      const { error: paymentError } = await s.from('payment_transactions').insert({
        company_id: companyId,
        subscription_id: result.id,
        amount: price,
        currency: 'SAR',
        status: 'pending',
        transaction_date: today,
      });
      if (paymentError) throw paymentError;
    }

    return success({ subscription: result, plan, requiresPayment: price > 0 });
  } catch (err) {
    return handleApiError(err);
  }
}
