import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { normalizeAdminPlanInput } from '@/lib/admin-plan-input';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { data, error: queryError } = await getSupabase().from('subscription_plans')
      .select('id, code, name, description, description_ar, currency, price_monthly, price_yearly, yearly_discount_percent, trial_days, max_users, max_clients, max_suppliers, max_employees, max_projects, max_invoices_per_month, max_quotations_per_month, max_storage_mb, features, features_modules, is_active, sort_order, created_at, updated_at')
      .order('sort_order')
      .order('price_monthly', { ascending: true });
    if (queryError) throw queryError;
    return success({ plans: data || [] });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const parsed = normalizeAdminPlanInput(await parseBody<unknown>(req));
    if (parsed.ok === false) return error(parsed.message);

    const { data, error: createError } = await getSupabase().rpc('admin_manage_subscription_plan', {
      p_admin_id: admin.adminId,
      p_action: 'create',
      p_plan_id: null,
      p_payload: parsed.payload,
    });
    if (createError) {
      if (createError.code === '23505') return error('كود الباقة مستخدم مسبقاً', 409);
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return adminJsonError(err);
  }
}
