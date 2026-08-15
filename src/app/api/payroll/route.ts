import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'payroll', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const employeeId = url.searchParams.get('employeeId');

    let query = s.from('payroll')
      .select('*, employees(name, department)', { count: 'exact' }).eq('company_id', auth.companyId);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (employeeId) query = query.eq('employee_id', employeeId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const records = (data || []).map((p: any) => ({ ...p, employee_name: p.employees?.name || null, department: p.employees?.department || null }));
    return success({ records, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'payroll', 'create');
    const s = sb();
    const data = await parseBody(req);
    const { date, employee_ids } = data;
    if (!date || !Array.isArray(employee_ids) || employee_ids.length === 0)
      return error('date, employee_ids are required');
    if (new Set(employee_ids).size !== employee_ids.length) return error('لا يمكن تكرار الموظف في دفعة الرواتب');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return error('التاريخ غير صالح');
    if (employee_ids.length>500 || employee_ids.some((id: unknown) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) {
      return error('قائمة الموظفين غير صالحة');
    }
    const { data: result, error: rpcErr } = await s.rpc('post_payroll_batch', {
      p_company_id: auth.companyId,
      p_date: date,
      p_employee_ids: employee_ids,
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success((result as Record<string,any>)?.records || [],201);
  } catch (err) { return handleApiError(err); }
}
