import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, notFound, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const __admin = await requireAdmin(request);
    const { id } = await paramsPromise;
    if (!/^[0-9a-fA-F-]{8,}$/.test(id)) return error('معرّف الشركة غير صالح', 400);

    const s = sb();

    // Get company info — safe column list (no secrets / internal metadata)
    const { data: company, error: companyErr } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, vat_number, address, phone, email, country, country_code, currency_code, currency_symbol, vat_rate, is_active, created_at, updated_at, trial_end_date')
      .eq('id', id)
      .maybeSingle();

    if (companyErr || !company) return notFound();

    // Get users
    const { data: users } = await s.from('users')
      .select('id, name, email, role, is_active, created_at, last_login')
      .eq('company_id', id)
      .order('created_at');

    // Get subscription
    const { data: subscription } = await s.from('subscriptions')
      .select('id, subscriber_number, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew, subscription_plans(name, max_users, max_projects, max_clients, max_suppliers, max_employees, features)')
      .eq('company_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get project count
    const { count: projectCount } = await s.from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', id);

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
    if (!/^[0-9a-fA-F-]{8,}$/.test(id)) return error('معرّف الشركة غير صالح', 400);

    const body = await parseBody<any>(request);

    const s = sb();
    const { data: company } = await s.from('companies')
      .select('id, name, is_active')
      .eq('id', id)
      .maybeSingle();

    if (!company) return notFound();

    // Determine action
    if (body.action === 'toggle_status') {
      // Toggle status - requires master password
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(__admin.adminId, masterHeader);
      if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);

      const { error: updateErr } = await s.from('companies')
        .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (updateErr) throw updateErr;

      await auditLog(__admin.adminId, body.is_active ? 'activate_company' : 'deactivate_company',
        JSON.stringify({ companyName: company.name }), 'company', id);

      return success({ message: body.is_active ? 'تم تفعيل الشركة' : 'تم إيقاف الشركة' });
    }

    if (body.action === 'edit_company') {
      // Edit company info - requires master password
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(__admin.adminId, masterHeader);
      if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);

      const updateData: any = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) updateData.name = body.name;
      if (body.commercial_registration !== undefined) updateData.commercial_registration = body.commercial_registration;
      if (body.tax_number !== undefined) updateData.tax_number = body.tax_number;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.address !== undefined) updateData.address = body.address;
      if (body.country !== undefined) updateData.country = body.country;
      if (body.vat_rate !== undefined) updateData.vat_rate = body.vat_rate;

      const { error: updateErr } = await s.from('companies')
        .update(updateData)
        .eq('id', id);
      if (updateErr) throw updateErr;

      await auditLog(__admin.adminId, 'edit_company',
        JSON.stringify({ companyName: company.name, fields: Object.keys(updateData) }), 'company', id);

      return success({ message: 'تم تحديث بيانات الشركة' });
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

      const { data: sub } = await s.from('subscriptions')
        .select('id')
        .eq('company_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sub) return error('لا يوجد اشتراك');

      await s.from('subscriptions')
        .update({ status: 'cancelled', auto_renew: false })
        .eq('id', (sub as any).id);

      try {
        await s.from('notifications').insert({
          company_id: id,
          title: 'تم إلغاء اشتراكك',
          message: 'تم إلغاء اشتراكك. يرجى التواصل مع الدعم لإعادة التفعيل.',
          type: 'subscription',
          is_read: false,
        });
      } catch {}

      await auditLog(__admin.adminId, 'cancel_subscription',
        JSON.stringify({ companyName: company.name }), 'company', id);

      return success({ message: 'تم إلغاء الاشتراك' });
    }

    return error('إجراء غير معروف');
  } catch (err) {
    return adminJsonError(err);
  }
}
