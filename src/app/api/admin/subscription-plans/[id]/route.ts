import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseBody(req);

    const update: any = {};
    if (body.code !== undefined) update.code = body.code;
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.priceMonthly !== undefined) update.price_monthly = body.priceMonthly;
    if (body.priceYearly !== undefined) update.price_yearly = body.priceYearly;
    if (body.maxUsers !== undefined) update.max_users = body.maxUsers;
    if (body.maxProjects !== undefined) update.max_projects = body.maxProjects;
    if (body.isActive !== undefined) update.is_active = body.isActive;

    const s = sb();
    const { data, error: updateErr } = await s.from('subscription_plans')
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const s = sb();

    const { data: deps } = await s.from('subscriptions')
      .select('id')
      .eq('plan_id', id)
      .limit(1);
    if (deps && deps.length > 0) return error('Cannot delete: plan has active subscriptions');

    const { data, error: deleteErr } = await s.from('subscription_plans')
      .delete()
      .eq('id', id)
      .select('id');
    if (deleteErr) throw deleteErr;
    if (!data || data.length === 0) return error('Not found', 404);

    return success({ deleted: true });
  } catch (e: any) {
    return serverError(e);
  }
}
