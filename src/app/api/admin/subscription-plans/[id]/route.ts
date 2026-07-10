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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;
    const body = await parseBody(req);

    const update: any = {};
    if (body.code !== undefined) update.code = body.code;
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.description_ar !== undefined) update.description_ar = body.description_ar;
    if (body.priceMonthly !== undefined) update.price_monthly = body.priceMonthly;
    if (body.price_monthly !== undefined) update.price_monthly = body.price_monthly;
    if (body.price_yearly !== undefined) update.price_yearly = body.price_yearly;
    if (body.yearly_discount_percent !== undefined) update.yearly_discount_percent = body.yearly_discount_percent;
    if (body.trial_days !== undefined) update.trial_days = body.trial_days;
    if (body.maxUsers !== undefined) update.max_users = body.maxUsers;
    if (body.max_users !== undefined) update.max_users = body.max_users;
    if (body.max_clients !== undefined) update.max_clients = body.max_clients;
    if (body.max_suppliers !== undefined) update.max_suppliers = body.max_suppliers;
    if (body.max_employees !== undefined) update.max_employees = body.max_employees;
    if (body.maxProjects !== undefined) update.max_projects = body.maxProjects;
    if (body.max_projects !== undefined) update.max_projects = body.max_projects;
    if (body.max_invoices_per_month !== undefined) update.max_invoices_per_month = body.max_invoices_per_month;
    if (body.max_storage_mb !== undefined) update.max_storage_mb = body.max_storage_mb;
    if (body.features_modules !== undefined) update.features_modules = body.features_modules;
    if (body.isActive !== undefined) update.is_active = body.isActive;
    if (body.is_active !== undefined) update.is_active = body.is_active;
    update.updated_at = new Date().toISOString();

    const s = sb();
    const { data, error: updateErr } = await s.from('subscription_plans')
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

    const { data, error: delErr } = await s.from('subscription_plans')
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
