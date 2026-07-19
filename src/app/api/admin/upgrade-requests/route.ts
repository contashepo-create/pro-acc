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
  return payload;
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
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
    return serverError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
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
        reviewed_by: admin.userId,
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
        // حساب تاريخ الانتهاء
        const durationDays = reqData.duration_type === 'yearly' ? 365 : 30;
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + durationDays);

        // جلب كود الباقة
        let planCode = 'basic';
        if (reqData.requested_plan_id) {
          const { data: plan } = await s.from('subscription_plans')
            .select('code')
            .eq('id', reqData.requested_plan_id)
            .maybeSingle();
          if (plan) planCode = (plan as any).code;
        }

        // البحث عن اشتراك حالي
        const { data: currentSub } = await s.from('subscriptions')
          .select('id')
          .eq('company_id', reqData.company_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (currentSub) {
          await s.from('subscriptions').update({
            plan_id: reqData.requested_plan_id || null,
            plan_code: planCode,
            status: 'active',
            end_date: endDate.toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
          }).eq('id', (currentSub as any).id);
        } else {
          await s.from('subscriptions').insert({
            company_id: reqData.company_id,
            plan_id: reqData.requested_plan_id || null,
            plan_code: planCode,
            status: 'active',
            start_date: new Date().toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
          });
        }

        // إشعار الشركة
        try {
          await s.from('company_messages').insert({
            company_id: reqData.company_id,
            subject: 'تمت الموافقة على طلب الترقية',
            body: `تمت الموافقة على ترقيتك. استمتع بالمميزات الجديدة!`,
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
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    requireAdmin(req);
    const s = sb();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return error('id is required');

    await s.from('upgrade_requests').delete().eq('id', id);
    return success({ deleted: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}
