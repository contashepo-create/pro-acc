import { NextRequest } from 'next/server';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { success, error, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const s = sb();
    const status = req.nextUrl.searchParams.get('status') || 'pending';
    let q = s.from('addon_requests')
      .select(`
        *,
        companies(id,name,email,phone),
        users(id,name,email)
      `)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status !== 'all') q = q.eq('status', status);
    const { data, error: err } = await q;
    if (err) throw err;
    return success({ requests: data || [] });
  } catch (e) {
    return adminJsonError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const s = sb();
    const body = await parseBody<{
      id?: string;
      status?: 'approved' | 'rejected';
      admin_notes?: string;
    }>(req);
    if (!body.id) return error('id مطلوب');
    if (body.status !== 'approved' && body.status !== 'rejected') return error('حالة غير صالحة');

    const { data: existing, error: fErr } = await s.from('addon_requests')
      .select('*').eq('id', body.id).maybeSingle();
    if (fErr || !existing) return error('الطلب غير موجود', 404);
    const req_ = existing as Record<string, any>;
    if (req_.status !== 'pending') return error('تمت مراجعة هذا الطلب مسبقاً', 400);

    const patch: Record<string, any> = {
      status: body.status,
      admin_notes: body.admin_notes || null,
      reviewed_by: admin.adminId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (body.status === 'approved') {
      // Atomically update the subscription + insert grant audit.
      // 1) Fetch current subscription
      const { data: sub, error: sErr } = await s.from('subscriptions')
        .select('id, extra_users, extra_branches, company_id, plan_id, addons_json')
        .eq('company_id', req_.company_id)
        .order('created_at', { ascending: false})
        .limit(1).maybeSingle();
      if (sErr || !sub) return error('لا يوجد اشتراك لهذه الشركة', 400);
      const curSub = sub as Record<string, any>;

      const prevUsers = Number(curSub.extra_users || 0);
      const prevBranches = Number(curSub.extra_branches || 0);
      let newUsers = prevUsers;
      let newBranches = prevBranches;

      if (req_.addon_type === 'extra_user') newUsers += Number(req_.quantity);
      if (req_.addon_type === 'extra_branch') newBranches += Number(req_.quantity);

      const currentAddons = curSub.addons_json && typeof curSub.addons_json === 'object'
        ? (curSub.addons_json as Record<string, any>)
        : {};
      const addonKey =
        req_.addon_type === 'extra_user' ? 'extra_users_total_paid' :
        req_.addon_type === 'extra_branch' ? 'extra_branches_total_paid' :
        'extra_storage_gb_paid';
      const addonMerge: Record<string, any> = {
        ...currentAddons,
        [addonKey]: Number(currentAddons[addonKey] || 0) + Number(req_.quantity),
        last_addon_purchase_at: new Date().toISOString(),
      };

      const months = req_.duration_type === 'yearly' ? 12 : 1;

      const { error: uErr } = await s.from('subscriptions')
        .update({
          extra_users: newUsers,
          extra_branches: newBranches,
          addons_json: addonMerge,
          updated_at: new Date().toISOString(),
        })
        .eq('id', curSub.id);
      if (uErr) {
        console.error('addon approval sub update failed:', uErr);
        return error('فشل تحديث الاشتراك: ' + uErr.message, 500);
      }

      // Insert audit row
      await s.from('addon_grant_audit').insert({
        company_id: req_.company_id,
        request_id: req_.id,
        admin_id: admin.adminId,
        addon_type: req_.addon_type,
        quantity: Number(req_.quantity),
        months_granted: months,
        previous_extra_users: prevUsers,
        previous_extra_branches: prevBranches,
        new_extra_users: newUsers,
        new_extra_branches: newBranches,
        note: body.admin_notes || null,
      });

      // Notify customer via company_messages
      try {
        const labels = { extra_user: 'مستخدم إضافي', extra_branch: 'فرع/مستودع إضافي', storage_gb: 'سعة تخزين إضافية' };
        await s.from('company_messages').insert({
          company_id: req_.company_id,
          subject: `تم تفعيل إضافة: ${(labels as any)[req_.addon_type]}`,
          body: `تمت الموافقة على طلب الإضافة وعدد ${req_.quantity} × ${(labels as any)[req_.addon_type]} لمدة ${months === 12 ? 'سنة' : 'شهر'}. أصبح لديك الآن ${newUsers} مقعد مستخدم إضافي و${newBranches} فرع/مستودع إضافي.`,
          type: 'addon_granted',
          status: 'open',
        });
      } catch {}
    }

    const { error: rErr } = await s.from('addon_requests').update(patch).eq('id', body.id);
    if (rErr) throw rErr;
    return success({ updated: true });
  } catch (e) {
    return adminJsonError(e);
  }
}
