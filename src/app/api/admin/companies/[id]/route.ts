import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, notFound, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword } from '@/lib/admin-auth';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await paramsPromise;
    if (!UUID.test(id)) return error('معرّف الشركة غير صالح', 400);

    const s = sb();

    // Get company info — safe column list (no secrets / internal metadata)
    const { data: company, error: companyErr } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, country, country_code, currency_code, currency_symbol, vat_rate, is_active, created_at, updated_at, trial_end_date')
      .eq('id', id)
      .maybeSingle();

    if (companyErr) throw companyErr;
    if (!company) return notFound();

    // Get users
    const { data: users, error: usersError } = await s.from('users')
      .select('id, name, email, role, is_active, created_at, last_login')
      .eq('company_id', id)
      .order('created_at');
    if (usersError) throw usersError;

    // Get subscription
    const { data: subscription, error: subscriptionError } = await s.from('subscriptions')
      .select('id, subscriber_number, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew, subscription_plans(name, max_users, max_projects, max_clients, max_suppliers, max_employees, features)')
      .eq('company_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;

    // Get project count
    const { count: projectCount, error: projectCountError } = await s.from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', id);
    if (projectCountError) throw projectCountError;

    return success({
      company,
      users: users || [],
      subscription,
      stats: {
        user_count: users?.length || 0,
        project_count: projectCount || 0,
      },
    });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const __admin = await requireAdmin(request);
    const { id } = await paramsPromise;
    if (!UUID.test(id)) return error('معرّف الشركة غير صالح', 400);

    const body = await parseBody<any>(request);

    const s = sb();
    const { data: company, error: companyError } = await s.from('companies')
      .select('id, name, is_active')
      .eq('id', id)
      .maybeSingle();

    if (companyError) throw companyError;
    if (!company) return notFound();

    // Determine action
    if (body.action === 'toggle_status') {
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(__admin.adminId, masterHeader);
      if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);
      if (typeof body.is_active !== 'boolean') return error('حالة الشركة غير صالحة');

      const { error: updateErr } = await s.rpc('set_company_status_atomic', {
        p_company_id: id,
        p_admin_id: __admin.adminId,
        p_is_active: body.is_active,
      });
      if (updateErr) throw updateErr;
      return success({ message: body.is_active ? 'تم تفعيل الشركة' : 'تم إيقاف الشركة' });
    }

    if (body.action === 'edit_company') {
      // Edit company info - requires master password
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(__admin.adminId, masterHeader);
      if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);

      const limits: Record<string, number> = {
        name: 200, commercial_registration: 100, tax_number: 100, phone: 50,
        email: 254, address: 1000, country: 100,
      };
      const patch: Record<string, string | number> = {};
      for (const [field, max] of Object.entries(limits)) {
        if (body[field] === undefined) continue;
        if (typeof body[field] !== 'string' || body[field].length > max) return error(`قيمة ${field} غير صالحة`);
        if (field === 'name' && !body[field].trim()) return error('اسم الشركة مطلوب');
        patch[field] = body[field].trim();
      }
      if (patch.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(patch.email))) return error('البريد الإلكتروني غير صالح');
      if (body.vat_rate !== undefined) {
        const vatRate = Number(body.vat_rate);
        if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) return error('نسبة الضريبة غير صالحة');
        patch.vat_rate = vatRate;
      }
      if (!Object.keys(patch).length) return error('لا توجد حقول قابلة للتحديث');

      const { data: updated, error: updateErr } = await s.rpc('admin_update_company_profile', {
        p_admin_id: __admin.adminId,
        p_company_id: id,
        p_patch: patch,
      });
      if (updateErr) throw updateErr;
      if ((updated as { not_found?: boolean } | null)?.not_found) return notFound();
      return success({ message: 'تم تحديث بيانات الشركة', company: updated });
    }

    if (body.action === 'change_plan') {
      return error('تغيير الباقة المدفوعة يتم فقط عبر طلب ترقية معتمد أو كود تفعيل', 409);
    }

    if (body.action === 'extend_subscription') {
      return error('تمديد الاشتراك المدفوع يتطلب دفعاً معتمداً أو كود تفعيل؛ التجربة تمدد من المسار المخصص', 409);
    }

    if (body.action === 'cancel_subscription') {
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(__admin.adminId, masterHeader);
      if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);

      const { data: sub, error: subscriptionError } = await s.from('subscriptions')
        .select('id')
        .eq('company_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subscriptionError) throw subscriptionError;
      if (!sub) return error('لا يوجد اشتراك');

      const { error: cancelError } = await s.rpc('restrict_subscription_atomic', {
        p_subscription_id: (sub as any).id,
        p_admin_id: __admin.adminId,
        p_status: 'cancelled',
        p_end_date: null,
        p_extra_users: null,
        p_extra_branches: null,
        p_extra_storage_gb: null,
        p_notes: 'cancelled from company administration',
      });
      if (cancelError) throw cancelError;

      // A database trigger creates the warning in the same transaction as the
      // subscription restriction and its audit record.
      return success({ message: 'تم إلغاء الاشتراك' });
    }

    return error('إجراء غير معروف');
  } catch (err) {
    return adminJsonError(err);
  }
}
