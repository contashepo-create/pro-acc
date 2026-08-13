import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();



export async function GET(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const s = sb();
    const status = req.nextUrl.searchParams.get('status') || 'pending';

    // جلب طلبات الترقية مع البيانات الأساسية
    const { data: requests, error: reqErr } = await s.from('upgrade_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (reqErr) {
      console.error('Error fetching upgrade requests:', reqErr);
      // إذا كان الجدول غير موجود
      if (reqErr.code === '42P01') {
        return success({ requests: [] });
      }
      throw reqErr;
    }

    let filtered = requests || [];
    if (status !== 'all') {
      filtered = filtered.filter((r: any) => r.status === status);
    }

    // جلب بيانات الشركات والباقات يدوياً
    const enriched = await Promise.all(filtered.map(async (req: any) => {
      let companyData = { name: '', email: '', phone: '' };
      let planData = { name: '', code: '' };
      let userData = { name: '', email: '' };

      try {
        const { data: company } = await s.from('companies')
          .select('name, email, phone')
          .eq('id', req.company_id)
          .maybeSingle();
        if (company) companyData = company as any;
      } catch {}

      try {
        const { data: plan } = await s.from('subscription_plans')
          .select('name, code')
          .eq('id', req.requested_plan_id)
          .maybeSingle();
        if (plan) planData = plan as any;
      } catch {}

      try {
        const { data: user } = await s.from('users')
          .select('name, email')
          .eq('id', req.user_id)
          .maybeSingle();
        if (user) userData = user as any;
      } catch {}

      return {
        ...req,
        companies: companyData,
        subscription_plans: planData,
        users: userData,
      };
    }));

    return success({ requests: enriched });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    console.error('Upgrade requests GET error:', e);
    return adminJsonError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const body = await parseBody(req);
    const { id, status, admin_notes } = body;

    if (!id || !status) return error('id and status required');
    if (!['approved', 'rejected'].includes(status)) return error('Invalid status');

    const s = sb();

    // جلب الطلب
    const { data: existing, error: fetchErr } = await s.from('upgrade_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      console.error('Error fetching upgrade request:', fetchErr);
      return error('الطلب غير موجود', 404);
    }

    const reqData = existing as Record<string, any>;

    // تحديث حالة الطلب
    const { error: updateErr } = await s.from('upgrade_requests')
      .update({
        status,
        admin_notes: admin_notes || null,
        reviewed_by: __admin.adminId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateErr) {
      console.error('Error updating request status:', updateErr);
      throw updateErr;
    }

    // إذا تم قبول الطلب، نقوم بترقية الاشتراك
    if (status === 'approved') {
      try {
        const months = reqData.duration_type === 'yearly' ? 12 : 1;

        // جلب كود الباقة
        let planCode = 'start';
        let planName = '';
        if (reqData.requested_plan_id) {
          const { data: plan } = await s.from('subscription_plans')
            .select('code, name')
            .eq('id', reqData.requested_plan_id)
            .maybeSingle();
          if (plan) {
            planCode = (plan as any).code;
            planName = (plan as any).name || planCode;
          }
        }

        // البحث عن اشتراك حالي لحساب تاريخ البدء (stack if active)
        const { data: currentSub } = await s.from('subscriptions')
          .select('id, end_date, status')
          .eq('company_id', reqData.company_id)
          .order('created_at', { ascending: false})
          .limit(1)
          .maybeSingle();

        const now = new Date();
        let startDate: Date = now;
        if (currentSub) {
          const cur = currentSub as any;
          const curEnd = cur.end_date ? new Date(cur.end_date) : null;
          if (curEnd && curEnd > now) startDate = curEnd;
        }
        const endDate = new Date(startDate.getTime());
        endDate.setMonth(endDate.getMonth() + months);

        const patch: Record<string, any> = {
          plan_id: reqData.requested_plan_id || null,
          plan_code: planCode,
          status: 'active',
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        };

        if (currentSub) {
          await s.from('subscriptions').update(patch).eq('id', (currentSub as any).id);
        } else {
          await s.from('subscriptions').insert({
            company_id: reqData.company_id,
            ...patch,
          });
        }

        // Audit trail
        try {
          await s.from('addon_grant_audit').insert({
            company_id: reqData.company_id,
            admin_id: __admin.adminId,
            addon_type: 'plan_upgrade',
            quantity: months,
            months_granted: months,
            previous_extra_users: 0,
            previous_extra_branches: 0,
            new_extra_users: 0,
            new_extra_branches: 0,
            note: `upgrade approved → ${planCode} (${reqData.duration_type})`,
          });
        } catch {}

        // إشعار الشركة
        try {
          await s.from('company_messages').insert({
            company_id: reqData.company_id,
            subject: 'تمت الموافقة على طلب الترقية',
            body: `تمت الموافقة على ترقيتك إلى باقة \"${planName}\" لمدة ${months === 12 ? 'سنة' : 'شهر'}. تنتهي الباقة في ${endDate.toISOString().split('T')[0]}. استمتع بالمميزات الجديدة!`,
            type: 'upgrade',
            status: 'open',
          });
        } catch {}
      } catch (upgradeErr) {
        console.error('Error upgrading subscription:', upgradeErr);
        // لا نرجع خطأ لأن الطلب تم تحديثه بنجاح
      }
    }

    return success({ message: status === 'approved' ? 'تم قبول الطلب وترقية الاشتراك' : 'تم رفض الطلب' });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    console.error('Upgrade requests PUT error:', e);
    return adminJsonError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const s = sb();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return error('id is required');

    await s.from('upgrade_requests').delete().eq('id', id);
    return success({ deleted: true });
  } catch (e: any) {
    return adminJsonError(e);
  }
}
