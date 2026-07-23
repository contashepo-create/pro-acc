import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, notFound, parseBody, handleApiError } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const s = sb();

    // Get company info
    const { data: company, error: companyErr } = await s.from('companies')
      .select('*')
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
    return handleApiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

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
      const valid = await verifyMasterPassword(payload.userId, masterHeader);
      if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);

      const { error: updateErr } = await s.from('companies')
        .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (updateErr) throw updateErr;

      await auditLog(payload.userId, body.is_active ? 'activate_company' : 'deactivate_company',
        JSON.stringify({ companyName: company.name }), 'company', id);

      return success({ message: body.is_active ? 'تم تفعيل الشركة' : 'تم إيقاف الشركة' });
    }

    if (body.action === 'edit_company') {
      // Edit company info - requires master password
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(payload.userId, masterHeader);
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

      await auditLog(payload.userId, 'edit_company',
        JSON.stringify({ companyName: company.name, fields: Object.keys(updateData) }), 'company', id);

      return success({ message: 'تم تحديث بيانات الشركة' });
    }

    if (body.action === 'change_plan') {
      // Change subscription plan - requires master password
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(payload.userId, masterHeader);
      if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);

      const { data: plan } = await s.from('subscription_plans')
        .select('id, code, name, duration_days')
        .eq('id', body.plan_id)
        .maybeSingle();

      if (!plan) return error('الباقة غير موجودة');

      const now = new Date();
      const endDate = new Date();
      if (body.duration_days) {
        endDate.setDate(endDate.getDate() + body.duration_days);
      } else if ((plan as any).duration_days) {
        endDate.setDate(endDate.getDate() + (plan as any).duration_days);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      // Get next subscriber number if new subscription
      let subscriberNumber: number | null = null;
      const { data: existingSub } = await s.from('subscriptions')
        .select('id, subscriber_number')
        .eq('company_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSub && (existingSub as any).subscriber_number) {
        subscriberNumber = (existingSub as any).subscriber_number;
      } else {
        const { data: seqResult } = await s.rpc('nextval', { seq: 'subscriber_number_seq' }).single();
        subscriberNumber = seqResult as any || Math.floor(Math.random() * 90000) + 10000;
      }

      if (existingSub) {
        // Update existing subscription
        await s.from('subscriptions')
          .update({
            plan_id: body.plan_id,
            plan_code: (plan as any).code,
            status: 'active',
            start_date: now.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
            subscriber_number: subscriberNumber,
            auto_renew: body.auto_renew || false,
          })
          .eq('id', (existingSub as any).id);
      } else {
        // Create new subscription
        await s.from('subscriptions')
          .insert({
            company_id: id,
            plan_id: body.plan_id,
            plan_code: (plan as any).code,
            status: 'active',
            start_date: now.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
            subscriber_number: subscriberNumber,
            auto_renew: body.auto_renew || false,
          });
      }

      // Send notification to company
      try {
        await s.from('notifications').insert({
          company_id: id,
          title: 'تم تغيير باقة اشتراكك',
          message: `تم تغيير باقتك إلى: ${(plan as any).name}. تنتهي في: ${endDate.toISOString().split('T')[0]}`,
          type: 'subscription',
          is_read: false,
        });
      } catch {}

      await auditLog(payload.userId, 'change_company_plan',
        JSON.stringify({ companyName: company.name, planName: (plan as any).name }), 'company', id);

      return success({ message: `تم تغيير الباقة إلى ${(plan as any).name}` });
    }

    if (body.action === 'extend_subscription') {
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(payload.userId, masterHeader);
      if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);

      const { data: sub } = await s.from('subscriptions')
        .select('id, end_date, status')
        .eq('company_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!sub) return error('لا يوجد اشتراك لهذه الشركة');

      const currentEnd = new Date((sub as any).end_date || new Date());
      const newEnd = new Date(currentEnd);
      newEnd.setDate(newEnd.getDate() + (body.days || 30));

      await s.from('subscriptions')
        .update({ end_date: newEnd.toISOString().split('T')[0], status: 'active' })
        .eq('id', (sub as any).id);

      try {
        await s.from('notifications').insert({
          company_id: id,
          title: 'تم تمديد اشتراكك',
          message: `تم تمديد اشتراكك ${body.days || 30} يوم. تاريخ الانتهاء الجديد: ${newEnd.toISOString().split('T')[0]}`,
          type: 'subscription',
          is_read: false,
        });
      } catch {}

      await auditLog(payload.userId, 'extend_subscription',
        JSON.stringify({ companyName: company.name, days: body.days || 30 }), 'company', id);

      return success({ message: `تم تمديد الاشتراك ${body.days || 30} يوم` });
    }

    if (body.action === 'cancel_subscription') {
      const masterHeader = request.headers.get('x-master-password');
      if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة', 401);
      const valid = await verifyMasterPassword(payload.userId, masterHeader);
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

      await auditLog(payload.userId, 'cancel_subscription',
        JSON.stringify({ companyName: company.name }), 'company', id);

      return success({ message: 'تم إلغاء الاشتراك' });
    }

    return error('إجراء غير معروف');
  } catch (err) {
    return serverError(err);
  }
}
