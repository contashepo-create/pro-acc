import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

const sb = () => getSupabase();

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
    const s = sb();

    // التحقق من وجود الباقة
    const { data: existing, error: fetchErr } = await s.from('subscription_plans')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return error('الباقة غير موجودة', 404);
    }

    // بناء بيانات التحديث - فقط الأعمدة الموجودة
    const update: any = {};
    if (body.code !== undefined) update.code = body.code;
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.description_ar !== undefined) update.description_ar = body.description_ar;
    if (body.priceMonthly !== undefined) update.price_monthly = body.priceMonthly;
    if (body.price_monthly !== undefined) update.price_monthly = body.price_monthly;
    if (body.priceYearly !== undefined) update.price_yearly = body.priceYearly;
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
    if (body.features_modules !== undefined) {
      update.features_modules = typeof body.features_modules === 'string' 
        ? body.features_modules 
        : JSON.stringify(body.features_modules);
    }
    if (body.features !== undefined) {
      update.features = typeof body.features === 'string' 
        ? body.features 
        : JSON.stringify(body.features);
    }
    if (body.isActive !== undefined) update.is_active = body.isActive;
    if (body.is_active !== undefined) update.is_active = body.is_active;
    if (body.sort_order !== undefined) update.sort_order = body.sort_order;
    update.updated_at = new Date().toISOString();

    // محاولة التحديث - إذا فشل عمود معين، نحاول بدون الأعمدة الناقصة
    let { data, error: updateErr } = await s.from('subscription_plans')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    // إذا فشل بسبب عمود غير موجود، نحاول بحقول أساسية فقط
    if (updateErr && updateErr.message?.includes('column')) {
      console.warn('Some columns may not exist, trying with basic fields only:', updateErr.message);
      
      const basicUpdate: any = { updated_at: new Date().toISOString() };
      const safeFields = ['code', 'name', 'description', 'price_monthly', 'price_yearly', 'max_users', 'max_projects', 'is_active', 'sort_order'];
      
      for (const field of safeFields) {
        if (update[field] !== undefined) {
          basicUpdate[field] = update[field];
        }
      }

      const retry = await s.from('subscription_plans')
        .update(basicUpdate)
        .eq('id', id)
        .select()
        .single();

      if (retry.error) {
        console.error('Retry also failed:', retry.error);
        return error('فشل تحديث الباقة: ' + retry.error.message, 500);
      }
      data = retry.data;
    } else if (updateErr) {
      console.error('Update error:', updateErr);
      return error('فشل تحديث الباقة: ' + updateErr.message, 500);
    }

    return success(data);
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    console.error('Plans PUT error:', e);
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;
    const s = sb();
    const url = new URL(req.url);
    const migrateTo = url.searchParams.get('migrate_to');

    // Check for existing subscribers
    const { count: subscriberCount } = await s.from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('plan_id', id);

    if (subscriberCount && subscriberCount > 0) {
      if (!migrateTo) {
        return error(`لا يمكن حذف الباقة — يوجد ${subscriberCount} مشترك. حدد باقة بديلة عبر migrate_to`, 400);
      }

      // Verify migration target exists
      const { data: targetPlan } = await s.from('subscription_plans')
        .select('id, name')
        .eq('id', migrateTo)
        .maybeSingle();

      if (!targetPlan) return error('الباقة البديلة غير موجودة', 404);

      // Migrate all subscribers
      const { error: migrateErr } = await s.from('subscriptions')
        .update({ plan_id: migrateTo, plan_code: (targetPlan as any).code || null })
        .eq('plan_id', id);

      if (migrateErr) return error('فشل ترحيل المشتركين: ' + migrateErr.message, 500);
    }

    const { data, error: delErr } = await s.from('subscription_plans')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (delErr) return error('فشل حذف الباقة: ' + delErr.message, 500);
    if (!data) return error('الباقة غير موجودة', 404);

    return success({ deleted: true, migrated: subscriberCount || 0 });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}
