import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/timesheets — List timesheets
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const employeeId = url.searchParams.get('employee_id');
    const projectId = url.searchParams.get('project_id');
    const dateFrom = url.searchParams.get('from');
    const dateTo = url.searchParams.get('to');
    const status = url.searchParams.get('status');

    let query = s.from('timesheets')
      .select('*, employees(name), projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (employeeId) query = query.eq('employee_id', employeeId);
    if (projectId) query = query.eq('project_id', projectId);
    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: qErr, count } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    const timesheets = (data || []).map((t: any) => ({
      ...t,
      employee_name: t.employees?.name || null,
      project_name: t.projects?.name || null,
      total_hours: calculateTotalHours(t),
      overtime_hours: calculateOvertime(t),
    }));

    // Summary stats
    const totalHours = timesheets.reduce((sum: number, t: any) => sum + t.total_hours, 0);
    const totalOvertime = timesheets.reduce((sum: number, t: any) => sum + t.overtime_hours, 0);

    return success({
      timesheets,
      total: count || 0,
      page,
      pageSize,
      summary: { totalHours, totalOvertime, entries: timesheets.length },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/timesheets — Create timesheet entry (clock in/out)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.employee_id || !body.date) {
      return error('رقم الموظف والتاريخ مطلوبان');
    }

    const timesheetId = generateId();
    const checkIn = body.check_in || new Date().toISOString();
    const checkOut = body.check_out || null;

    // Calculate hours
    let regularHours = 0;
    let overtimeHours = 0;
    if (checkOut) {
      const totalMinutes = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000;
      const totalHours = totalMinutes / 60;
      const standardDay = body.standard_hours || 8;
      regularHours = Math.min(totalHours, standardDay);
      overtimeHours = Math.max(0, totalHours - standardDay);
    }

    const { data, error: insertErr } = await s.from('timesheets')
      .insert({
        id: timesheetId,
        company_id: auth.companyId,
        employee_id: body.employee_id,
        project_id: body.project_id || null,
        date: body.date,
        check_in: checkIn,
        check_out: checkOut,
        regular_hours: regularHours,
        overtime_hours: overtimeHours,
        break_minutes: body.break_minutes || 0,
        work_type: body.work_type || 'normal', // normal, overtime, holiday, weekend
        hourly_rate: body.hourly_rate || null,
        description: body.description || null,
        status: checkOut ? 'completed' : 'in_progress',
        approved_by: null,
        created_by: auth.userId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

function calculateTotalHours(t: any): number {
  if (t.check_out && t.check_in) {
    return (new Date(t.check_out).getTime() - new Date(t.check_in).getTime()) / 3600000;
  }
  return (parseFloat(t.regular_hours) || 0) + (parseFloat(t.overtime_hours) || 0);
}

function calculateOvertime(t: any): number {
  return parseFloat(t.overtime_hours) || 0;
}
