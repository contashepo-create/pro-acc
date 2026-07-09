import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET() {
  try {
    const s = sb();
    const { data, error: err } = await s.from('subscription_plans')
      .select('*')
      .order('sort_order');
    if (err) throw err;

    return success({ plans: data || [] });
  } catch (e: any) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req);
    const { code, name, description, priceMonthly, priceYearly, maxUsers, maxProjects, features } = body;
    if (!code || !name) return error('code and name are required');

    const s = sb();
    const { data, error: insertErr } = await s.from('subscription_plans').insert({
      code,
      name,
      description: description || '',
      price_monthly: priceMonthly || 0,
      price_yearly: priceYearly || null,
      max_users: maxUsers || 1,
      max_projects: maxProjects || null,
      features: JSON.stringify(features || []),
    }).select().single();

    if (insertErr) throw insertErr;

    return success(data);
  } catch (e: any) {
    return serverError(e);
  }
}
