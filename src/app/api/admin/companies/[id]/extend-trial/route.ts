import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword } from '@/lib/admin-auth';

const sb = () => getSupabase();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const __admin = await requireAdmin(request);
    const { id: companyId } = await params;
    // Validate UUID shape to prevent path-based filter injection
    if (!/^[0-9a-fA-F-]{8,}$/.test(companyId)) return error('معرّف الشركة غير صالح', 400);

    const body = await parseBody(request);
    const { days = 7, reason, masterPassword } = body;

    // Sensitive monetary action: require master password re-entry
    if (!masterPassword) return error('كلمة المرور الرئيسية مطلوبة', 401);
    const ok = await verifyMasterPassword(__admin.adminId, String(masterPassword));
    if (!ok) return error('كلمة المرور الرئيسية غير صحيحة', 401);

    if (days !== 7) {
      return error('التمديد المسموح به هو 7 أيام فقط', 400);
    }
    if (reason && String(reason).length > 500) return error('السبب طويل جداً', 400);

    const s = sb();

    // Get current subscription
    const { data: sub, error: subErr } = await s.from('subscriptions')
      .select('id, status, trial_extended, end_date')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (subErr || !sub) {
      return error('لا يوجد اشتراك لهذه الشركة', 404);
    }

    const subData = sub as Record<string, any>;

    if (subData.status !== 'trial') {
      return error('التمديد متاح فقط للباقات التجريبية', 400);
    }

    if (subData.trial_extended) {
      return error('تم تمديد هذه الفترة التجريبية من قبل. لا يمكن التمديد مرة أخرى', 400);
    }

    const currentEndDate = new Date(subData.end_date);
    const newEndDate = new Date(currentEndDate.getTime() + days * 86400000);

    const { data: updated, error: updateErr } = await s.from('subscriptions')
      .update({
        end_date: newEndDate.toISOString().split('T')[0],
        trial_extended: true,
        trial_extended_by: __admin.adminId,
        trial_extended_at: new Date().toISOString(),
        original_end_date: subData.end_date,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subData.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Audit log
    await s.from('admin_audit_log').insert({
      admin_id: __admin.adminId,
      action: 'extend_trial',
      details: `Extended trial for company ${companyId} by ${days} days. Reason: ${reason || 'N/A'}`,
      target_type: 'company',
      target_id: companyId,
    });

    // Notify company
    await s.from('notifications').insert({
      company_id: companyId,
      title: 'تم تمديد الفترة التجريبية',
      body: `تم تمديد فترتك التجريبية 7 أيام إضافية. تنتهي الآن في ${newEndDate.toLocaleDateString('ar-EG')}`,
      type: 'subscription',
    });

    return success({ subscription: updated, message: `تم تمديد الفترة التجريبية 7 أيام. تنتهي الآن في ${newEndDate.toISOString().split('T')[0]}` });
  } catch (e) {
    return adminJsonError(e);
  }
}
