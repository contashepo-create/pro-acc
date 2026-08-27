import {NextRequest} from 'next/server';
import {success, error, notFound, handleApiError, parseBody, requireModulePermission} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'timesheets', 'update');
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return error('معرّف الوردية غير صالح');
    const s = sb();
    const body = await parseBody(request);
    const { action } = body;

    // Handle clock out
    if (action === 'clock_out') {
      const { data: ts } = await s.from('timesheets')
        .select('*')
        .eq('id', id)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (!ts) return notFound();
      const t = ts as Row;
      if (t.status === 'completed') return error('تم تسجيل الانصراف بالفعل');
      if (t.status !== 'in_progress') return error('لا يمكن تسجيل انصراف على وردية بهذه الحالة', 409);

      const checkOut = String(body.check_out || new Date().toISOString());
      const outMs = new Date(checkOut).getTime();
      const inMs = new Date(String(t.check_in)).getTime();
      if (Number.isNaN(outMs)) return error('وقت الخروج غير صالح');
      if (outMs <= inMs) return error('وقت الخروج يجب أن يكون بعد وقت الدخول');
      if ((outMs - inMs) / 3600000 > 24 * 7) return error('مدة الوردية غير منطقية');
      const totalMinutes = (outMs - inMs) / 60000;
      const totalHours = Math.max(0, (totalMinutes - (parseFloat(String(t.break_minutes)) || 0)) / 60);
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
        .eq('id', id).eq('company_id', auth.companyId)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return success(data);
    }

    // Handle approval — only completed shifts may be decided, and only once.
    if (action === 'approve' || action === 'reject') {
      const { data: existing } = await s.from('timesheets')
        .select('status').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      if (!existing) return notFound();
      const st = String((existing as Row).status);
      if (st === 'approved' || st === 'rejected') return error('تم البت في هذه الوردية مسبقاً', 409);
      if (st !== 'completed') return error('لا يمكن الاعتماد إلا بعد تسجيل الانصراف', 409);

      const { data, error: updateErr } = await s.from('timesheets')
        .update({
          status: action === 'approve' ? 'approved' : 'rejected',
          approved_by: auth.userId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('company_id', auth.companyId)
        .eq('status', 'completed')
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
