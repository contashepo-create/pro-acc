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

    // استخدام استعلام أبسط بدون joins معقدة
    let query = s.from('upgrade_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error: err } = await query;
    if (err) {
      console.error('Error fetching upgrade requests:', err);
      // إذا كان الجدول غير موجود
      if (err.code === '42P01') {
        return success({ requests: [] });
      }
      throw err;
    }

    // جلب بيانات الشركات والمستخدمين يدوياً
    const requestsWithData = await Promise.all((data || []).map(async (req: any) => {
      let companyName = '';
      let userName = '';
      let userEmail = '';
      let planName = '';
      let planCode = '';

      try {
        const { data: company } = await s.from('companies')
          .select('name, email, phone')
          .eq('id', req.company_id)
          .maybeSingle();
        if (company) {
          companyName = (company as any).name || '';
          userEmail = (company as any).email || '';
        }
      } catch {}

      try {
        const { data: user } = await s.from('users')
          .select('name, email')
          .eq('id', req.user_id)
          .maybeSingle();
        if (user) {
          userName = (user as any).name || '';
          userEmail = (user as any).email || userEmail;
        }
      } catch {}

      try {
        const { data: plan } = await s.from('subscription_plans')
          .select('name, code')
          .eq('id', req.requested_plan_id)
          .maybeSingle();
        if (plan) {
          planName = (plan as any).name || '';
          planCode = (plan as any).code || '';
        }
      } catch {}

      return {
        ...req,
        company_name: companyName,
        company_email: userEmail,
        user_name: userName,
        user_email: userEmail,
        plan_name: planName,
        plan_code: planCode,
      };
    }));

    return success({ requests: requestsWithData });
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

    // جلب الطلب الموجود
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
      console.error('Error updating upgrade request:', updateErr);
      throw updateErr;
    }

    // إذا تم الموافقة، قم بترقية الاشتراك
    if (status === 'approved') {
      try {
        const durationDays = reqData.duration_type === 'yearly' ? 365 : 30;
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + durationDays);

        // جلب كود الباقة
        let planCode = reqData.requested_plan_code || 'basic';
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
          // تحديث الاشتراك
          await s.from('subscriptions').update({
            plan_id: reqData.requested_plan_id || null,
            plan_code: planCode,
            status: 'active',
            end_date: endDate.toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
          }).eq('id', (currentSub as Record<string, any>).id);
        } else {
          // إنشاء اشتراك جديد
          await s.from('subscriptions').insert({
            company_id: reqData.company_id,
            plan_id: reqData.requested_plan_id || null,
            plan_code: planCode,
            status: 'active',
            start_date: new Date().toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
          });
        }

        // إضافة إشعار للشركة
        try {
          await s.from('notifications').insert({
            company_id: reqData.company_id,
            title: 'تمت الموافقة على طلب الترقية',
            body: `تمت الموافقة على ترقيتك. استمتع بالمميزات الجديدة!`,
            type: 'subscription',
          });
        } catch (notifErr) {
          console.warn('Failed to create notification:', notifErr);
        }
      } catch (upgradeErr) {
        console.error('Error upgrading subscription:', upgradeErr);
        // لا نرجع خطأ هنا لأن الطلب تم تحديثه بنجاح
      }
    }

    return success({ message: status === 'approved' ? 'تمت الموافقة على الطلب وترقية الاشتراك' : 'تم رفض الطلب' });
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
