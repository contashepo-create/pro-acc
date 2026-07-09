import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const s = sb();

    const { data: sub, error: subErr } = await s.from('subscriptions')
      .select('*')
      .eq('id', id)
      .single();

    if (subErr || !sub) return error('Not found', 404);

    // Fetch company name
    let companyName: string | null = null;
    if (sub.company_id) {
      const { data: company } = await s.from('companies')
        .select('name')
        .eq('id', sub.company_id)
        .single();
      companyName = company?.name || null;
    }

    // Fetch plan name and price
    let planName: string | null = null;
    let planPriceMonthly: number | null = null;
    if (sub.plan_id) {
      const { data: plan } = await s.from('subscription_plans')
        .select('name, price_monthly')
        .eq('id', sub.plan_id)
        .single();
      if (plan) {
        planName = plan.name;
        planPriceMonthly = plan.price_monthly;
      }
    }

    // Fetch payments
    const { data: payments, error: payErr } = await s.from('payment_transactions')
      .select('*')
      .eq('subscription_id', id)
      .order('transaction_date', { ascending: false });

    return success({
      ...sub,
      company_name: companyName,
      plan_name: planName,
      price_monthly: planPriceMonthly,
      payments: payments || [],
    });
  } catch (e: any) {
    return serverError(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseBody(req);

    const update: any = {};
    if (body.status !== undefined) update.status = body.status;
    if (body.endDate !== undefined) update.end_date = body.endDate;
    if (body.autoRenew !== undefined) update.auto_renew = body.autoRenew;

    const s = sb();
    const { data, error: updateErr } = await s.from('subscriptions')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (updateErr || !data) return error('Not found', 404);

    return success(data);
  } catch (e: any) {
    return serverError(e);
  }
}
