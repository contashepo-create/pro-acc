import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

// @ts-ignore
const sb = () => getSupabase() as any;

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
  return payload;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(request);
    const { id: companyId } = await params;
    const body = await parseBody(request);
    const { days = 7, reason } = body;

    if (days !== 7) {
      return error('التمديد المسموح به هو 7 أيام فقط', 400);
    }

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

    const subData: any = sub;

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
        trial_extended_by: admin.userId,
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
      admin_id: admin.userId,
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
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}
