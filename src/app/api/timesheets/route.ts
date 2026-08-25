import {NextRequest} from 'next/server';
import {success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';
import {generateId} from '@/lib/utils';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

/**
 * GET /api/timesheets — List timesheets
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'timesheets', 'read');
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

    const timesheets = (data || []).map((t: Row) => ({
      ...t,
      employee_name: t.employees ? String((t.employees as Row).name) || null : null,
      project_name: t.projects ? String((t.projects as Row).name) || null : null,
      total_hours: calculateTotalHours(t),
      overtime_hours: calculateOvertime(t),
    }));

    // Summary stats
    const totalHours = timesheets.reduce((sum: number, t: Row) => sum + Number(t.total_hours), 0);
    const totalOvertime = timesheets.reduce((sum: number, t: Row) => sum + Number(t.overtime_hours), 0);

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
    const auth = await requireModulePermission(request, 'timesheets', 'create');
    const s = sb();
    const body = await parseBody(request);

    if (!body.employee_id || !body.date) {
      return error('رقم الموظف والتاريخ مطلوبان');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) return error('تاريخ الوردية غير صالح');

    // Validate numeric inputs coming from the client — these feed payroll cost.
    const breakMinutes = Number(body.break_minutes || 0);
    if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 1440) return error('دقائق الراحة غير صالحة');
    const standardDay = Number(body.standard_hours || 8);
    if (!Number.isFinite(standardDay) || standardDay < 1 || standardDay > 24) return error('ساعات اليوم القياسية غير صالحة');
    let hourlyRate: number | null = null;
    if (body.hourly_rate !== undefined && body.hourly_rate !== null && body.hourly_rate !== '') {
      hourlyRate = Number(body.hourly_rate);
      if (!Number.isFinite(hourlyRate) || hourlyRate < 0 || hourlyRate > 100000) return error('أجر الساعة غير صالح');
    }

    const checkIn = String(body.check_in || new Date().toISOString());
    const checkOut = body.check_out ? String(body.check_out) : null;
    const inTime = new Date(checkIn).getTime();
    if (Number.isNaN(inTime)) return error('وقت الدخول غير صالح');
    let outTime: number | null = null;
    if (checkOut) {
      outTime = new Date(checkOut).getTime();
      if (Number.isNaN(outTime)) return error('وقت الخروج غير صالح');
      if (outTime <= inTime) return error('وقت الخروج يجب أن يكون بعد وقت الدخول');
      if ((outTime - inTime) / 3600000 > 24 * 7) return error('مدة الوردية غير منطقية');
    }

    // One open shift per employee — a second clock-in without clock-out is a data error.
    if (!outTime) {
      const { data: openShift } = await s.from('timesheets')
        .select('id').eq('company_id', auth.companyId).eq('employee_id', body.employee_id)
        .eq('status', 'in_progress').limit(1).maybeSingle();
      if (openShift) return error('لدي هذا الموظف وردية مفتوحة بالفعل — أغلقها أولاً', 409);
    }

    // عزل مستأجرين: الموظف والمشروع (إن وُجد) يجب أن ينتميا لهذه الشركة
    const { data: emp } = await s.from('employees')
      .select('id').eq('id', body.employee_id).eq('company_id', auth.companyId).maybeSingle();
    if (!emp) return error('الموظف غير موجود', 404);
    if (body.project_id) {
      const { data: proj } = await s.from('projects')
        .select('id').eq('id', body.project_id).eq('company_id', auth.companyId).maybeSingle();
      if (!proj) return error('المشروع غير موجود', 404);
    }

    const timesheetId = generateId();

    // Calculate hours
    let regularHours = 0;
    let overtimeHours = 0;
    if (outTime !== null) {
      const totalMinutes = (outTime - inTime) / 60000;
      const totalHours = Math.max(0, (totalMinutes - breakMinutes) / 60);
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
        break_minutes: breakMinutes,
        work_type: body.work_type || 'normal', // normal, overtime, holiday, weekend
        hourly_rate: hourlyRate,
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

function calculateTotalHours(t: Row): number {
  if (t.check_out && t.check_in) {
    return (new Date(String(t.check_out)).getTime() - new Date(String(t.check_in)).getTime()) / 3600000;
  }
  return (parseFloat(String(t.regular_hours)) || 0) + (parseFloat(String(t.overtime_hours)) || 0);
}

function calculateOvertime(t: Row): number {
  return parseFloat(String(t.overtime_hours)) || 0;
}
