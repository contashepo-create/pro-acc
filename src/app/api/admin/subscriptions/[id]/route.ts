import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

// @ts-ignore
const sb = () => getSupabase() as any;

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;
    const s = sb();

    const { data: sub, error: subErr } = await s.from('subscriptions')
      .select('*')
      .eq('id', id)
      .single();

    if (subErr || !sub) return error('Not found', 404);

    let companyName: string | null = null;
    if (sub.company_id) {
      const { data: company } = await s.from('companies')
        .select('name')
        .eq('id', sub.company_id)
        .single();
      companyName = company?.name || null;
    }

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

    return success({ ...sub, company_name: companyName, plan_name: planName, plan_price_monthly: planPriceMonthly });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;
    const body = await parseBody(req);
    const s = sb();

    const update: any = {};
    if (body.status !== undefined) update.status = body.status;
    if (body.end_date !== undefined) update.end_date = body.end_date;
    if (body.plan_id !== undefined) update.plan_id = body.plan_id;
    update.updated_at = new Date().toISOString();

    const { data, error: updateErr } = await s.from('subscriptions')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (updateErr || !data) return error('Not found', 404);

    return success(data);
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;
    const s = sb();

    const { data, error: delErr } = await s.from('subscriptions')
      .delete()
      .eq('id', id)
      .select('id')
      .single();

    if (delErr || !data) return error('Not found', 404);

    return success({ deleted: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}
