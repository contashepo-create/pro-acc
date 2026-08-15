import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword } from '@/lib/admin-auth';

const sb = () => getSupabase();

const SAFE_CODE = /^[a-z0-9_-]{2,32}$/i;

function normInt(v: unknown, def: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.floor(n));
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const __admin = await requireAdmin(req);
    const { id } = await params;
    if (!/^[0-9a-fA-F-]{8,}$/.test(id)) return error('معرّف الباقة غير صالح', 400);
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

    // التحقق من صحة الحقول المرسلة
    if (body.code !== undefined) {
      if (typeof body.code !== 'string' || !SAFE_CODE.test(body.code)) {
        return error('كود الباقة غير صالح (أحرف/أرقام/شرطات فقط، 2-32)');
      }
    }
    if (body.currency !== undefined) {
      if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) {
        return error('عملة الباقة غير صالحة (3 أحرف كبيرة مثل USD)');
      }
    }
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 120) {
        return error('اسم الباقة مطلوب (حتى 120 حرف)');
      }
    }

    // بناء بيانات التحديث - فقط الأعمدة الموجودة، مع تطبيع القيم الرقمية الفارغة إلى null
    const update: Record<string, any> = {};
    if (body.code !== undefined) update.code = String(body.code).trim().toLowerCase();
    if (body.name !== undefined) update.name = String(body.name).trim();
    if (body.description !== undefined) update.description = typeof body.description === 'string' ? body.description.slice(0, 500) : '';
    if (body.description_ar !== undefined) update.description_ar = typeof body.description_ar === 'string' ? body.description_ar.slice(0, 500) : '';
    if (body.currency !== undefined) update.currency = body.currency;

    if (body.priceMonthly !== undefined || body.price_monthly !== undefined) {
      update.price_monthly = normInt(body.priceMonthly ?? body.price_monthly, 0) ?? 0;
    }
    if (body.priceYearly !== undefined || body.price_yearly !== undefined) {
      update.price_yearly = normInt(body.priceYearly ?? body.price_yearly, null);
    }
    if (body.yearly_discount_percent !== undefined) {
      update.yearly_discount_percent = normInt(body.yearly_discount_percent, null);
    }
    if (body.trial_days !== undefined) {
      update.trial_days = normInt(body.trial_days, null);
    }

    // حدود الموارد: القيم الفارغة تُفسَّر على أنها "غير محدود" (null)
    if (body.maxUsers !== undefined || body.max_users !== undefined) {
      update.max_users = normInt(body.maxUsers ?? body.max_users, null);
    }
    if (body.max_clients !== undefined) update.max_clients = normInt(body.max_clients, null);
    if (body.max_suppliers !== undefined) update.max_suppliers = normInt(body.max_suppliers, null);
    if (body.max_employees !== undefined) update.max_employees = normInt(body.max_employees, null);
    if (body.maxProjects !== undefined || body.max_projects !== undefined) {
      update.max_projects = normInt(body.maxProjects ?? body.max_projects, null);
    }
    if (body.max_invoices_per_month !== undefined) {
      update.max_invoices_per_month = normInt(body.max_invoices_per_month, null);
    }
    if (body.max_quotations_per_month !== undefined) {
      update.max_quotations_per_month = normInt(body.max_quotations_per_month, null);
    }
    if (body.max_storage_mb !== undefined) {
      update.max_storage_mb = normInt(body.max_storage_mb, null);
    }

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
    if (body.isActive !== undefined || body.is_active !== undefined) {
      update.is_active = Boolean(body.isActive ?? body.is_active);
    }
    if (body.sort_order !== undefined) update.sort_order = normInt(body.sort_order, 0) ?? 0;
    update.updated_at = new Date().toISOString();

    // محاولة التحديث - إذا فشل عمود معين، نحاول بدون الأعمدة الناقصة
    let { data, error: updateErr } = await s.from('subscription_plans')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    // إذا فشل بسبب عمود غير موجود، نحاول بحقول أساسية فقط
    if (updateErr && updateErr.message?.includes('column')) {
      console.warn('Some columns may not exist, retrying with safe fields only:', updateErr.message);

      const basicUpdate: Record<string, any> = { updated_at: update.updated_at };
      const safeFields = [
        'code', 'name', 'description', 'description_ar', 'currency',
        'price_monthly', 'price_yearly', 'yearly_discount_percent', 'trial_days',
        'max_users', 'max_clients', 'max_suppliers', 'max_employees', 'max_projects',
        'max_invoices_per_month', 'max_quotations_per_month', 'max_storage_mb',
        'features', 'features_modules', 'is_active', 'sort_order',
      ];

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
    return adminJsonError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return error('معرّف الباقة غير صالح', 400);
    }
    const masterPassword = req.headers.get('x-master-password');
    if (!masterPassword) return error('كلمة المرور الرئيسية مطلوبة', 401);
    if (!await verifyMasterPassword(admin.adminId, masterPassword)) {
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    // Historical subscriptions keep their original plan relationship. Moving
    // them en masse during a plan deletion would silently rewrite paid
    // entitlements without payment evidence. Used plans can only be disabled.
    const { data, error: deleteError } = await sb().rpc('delete_unused_subscription_plan_atomic', {
      p_plan_id: id,
      p_admin_id: admin.adminId,
    });
    if (deleteError) {
      const message = String(deleteError.message || '');
      if (message.includes('الباقة غير موجودة')) return error(message, 404);
      if (message.includes('اشتراكات تاريخية')) return error(message, 409);
      throw deleteError;
    }
    return success(data);
  } catch (e: any) {
    return adminJsonError(e);
  }
}
