import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status');
    const s = sb();

    let queryBuilder = s.from('subscriptions').select('*');

    if (status) {
      queryBuilder = queryBuilder.eq('status', status);
    }

    queryBuilder = queryBuilder.order('created_at', { ascending: false });
    const { data: subscriptions, error: err } = await queryBuilder;
    if (err) throw err;

    // Fetch company names
    const companyIds = (subscriptions || []).map((s: any) => s.company_id).filter(Boolean);
    let companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await s.from('companies')
        .select('id, name')
        .in('id', [...new Set(companyIds)]);
      (companies || []).forEach((c: any) => { companyMap[c.id] = c.name; });
    }

    // Fetch plan names
    const planIds = (subscriptions || []).map((s: any) => s.plan_id).filter(Boolean);
    let planMap: Record<string, string> = {};
    if (planIds.length > 0) {
      const { data: plans } = await s.from('subscription_plans')
        .select('id, name')
        .in('id', [...new Set(planIds)]);
      (plans || []).forEach((p: any) => { planMap[p.id] = p.name; });
    }

    const result = (subscriptions || []).map((sub: any) => ({
      ...sub,
      company_name: companyMap[sub.company_id] || null,
      plan_name: planMap[sub.plan_id] || null,
    }));

    return success(result);
  } catch (e: any) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req);
    const { companyId, planCode, startDate, endDate, status, autoRenew } = body;
    if (!companyId || !planCode || !endDate) return error('companyId, planCode, endDate required');

    const s = sb();
    const insertData = {
      company_id: companyId,
      plan_code: planCode,
      status: status || 'active',
      start_date: startDate || new Date().toISOString().split('T')[0],
      end_date: endDate,
      auto_renew: autoRenew ?? false,
    };

    const { data, error: upsertErr } = await s.from('subscriptions')
      .upsert(insertData, { onConflict: 'company_id' })
      .select()
      .single();

    if (upsertErr) throw upsertErr;

    return success(data);
  } catch (e: any) {
    return serverError(e);
  }
}
