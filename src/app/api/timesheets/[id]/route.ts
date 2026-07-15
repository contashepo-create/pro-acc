import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();
    const { action } = body;

    // Handle clock out
    if (action === 'clock_out') {
      const { data: ts } = await s.from('timesheets')
        .select('*')
        .eq('id', id)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (!ts) return notFound();
      const t = ts as any;
      if (t.status === 'completed') return error('تم تسجيل الانصراف بالفعل');

      const checkOut = body.check_out || new Date().toISOString();
      const totalMinutes = (new Date(checkOut).getTime() - new Date(t.check_in).getTime()) / 60000;
      const totalHours = (totalMinutes - (parseFloat(t.break_minutes) || 0)) / 60;
      const standardDay = 8;
      const regularHours = Math.min(totalHours, standardDay);
      const overtimeHours = Math.max(0, totalHours - standardDay);

      const { data, error: updateErr } = await s.from('timesheets')
        .update({
          check_out: checkOut,
          regular_hours: regularHours,
          overtime_hours: overtimeHours,
          status: 'completed',
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return success(data);
    }

    // Handle approval
    if (action === 'approve' || action === 'reject') {
      const { data, error: updateErr } = await s.from('timesheets')
        .update({
          status: action === 'approve' ? 'approved' : 'rejected',
          approved_by: auth.userId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('company_id', auth.companyId)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return success(data);
    }

    return error('عملية غير صالحة');
  } catch (err) {
    return handleApiError(err);
  }
}
