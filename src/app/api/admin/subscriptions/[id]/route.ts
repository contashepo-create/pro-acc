import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(_req);
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الاشتراك غير صالح', 400);
    const s = sb();
    const { data, error: err } = await s.from('subscriptions')
      .select(`
        id, subscriber_number, company_id, plan_id, plan_code, status,
        start_date, end_date, trial_end_date, auto_renew,
        extra_users, extra_branches, extra_storage_gb, addons_json,
        created_at, updated_at,
        subscription_plans(
          id, code, name, description_ar, currency, price_monthly, price_yearly,
          trial_days, max_users, max_invoices_per_month, max_quotations_per_month,
          max_storage_mb, max_branches, features_modules, is_active
        ),
        companies(id,name,email,phone)
      `)
      .eq('id', id).maybeSingle();
    if (err) throw err;
    if (!data) return error('الاشتراك غير موجود', 404);
    return success({ subscription: data });
  } catch (e) { return adminJsonError(e); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الاشتراك غير صالح', 400);
    const body = await parseBody<{
      plan_id?: string;
      status?: string;
      end_date?: string;
      extra_users?: number | '';
      extra_branches?: number | '';
      extra_storage_gb?: number | '';
      notes?: string;
    }>(req);

    // This editor can only revoke entitlements. Paid activation, upgrades, and
    // trial extensions each have a separate proof-bearing workflow.
    if (body.plan_id !== undefined) {
      return error('تغيير الباقة المدفوعة يتم فقط عبر طلب ترقية معتمد أو كود تفعيل', 409);
    }
    if (body.status !== undefined && !['cancelled', 'expired'].includes(body.status)) {
      return error('لا يمكن منح حالة اشتراك مدفوعة من هذا المسار', 409);
    }
    if (body.end_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
      return error('تاريخ نهاية الاشتراك غير صالح');
    }

    const parsedExtras: Record<'extra_users' | 'extra_branches' | 'extra_storage_gb', number | null> = {
      extra_users: null,
      extra_branches: null,
      extra_storage_gb: null,
    };
    for (const key of Object.keys(parsedExtras) as Array<keyof typeof parsedExtras>) {
      if (body[key] === undefined) continue;
      const value = Number(body[key]);
      if (!Number.isSafeInteger(value) || value < 0) return error('قيمة الإضافة غير صالحة');
      parsedExtras[key] = value;
    }
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
      return error('الملاحظات غير صالحة');
    }

    const { data: updated, error: rpcError } = await sb().rpc('restrict_subscription_atomic', {
      p_subscription_id: id,
      p_admin_id: admin.adminId,
      p_status: body.status ?? null,
      p_end_date: body.end_date ?? null,
      p_extra_users: parsedExtras.extra_users,
      p_extra_branches: parsedExtras.extra_branches,
      p_extra_storage_gb: parsedExtras.extra_storage_gb,
      p_notes: body.notes?.trim() || null,
    });
    if (rpcError) {
      if (rpcError.message.includes('الاشتراك غير موجود')) return error('الاشتراك غير موجود', 404);
      if (rpcError.message.includes('لا توجد تغييرات')) return error(rpcError.message, 400);
      if (rpcError.message.includes('لا يمكن') || rpcError.message.includes('تمديد')) return error(rpcError.message, 409);
      throw rpcError;
    }
    return success({ subscription: updated });
  } catch (e) { return adminJsonError(e); }
}
