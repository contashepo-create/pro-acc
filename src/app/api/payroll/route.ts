import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hrDate, hrUuid, payrollBatchSchema } from '@/lib/hr-validation';

import type { Row } from '@/lib/types';

const PAYROLL_COLUMNS = `id,employee_id,date,basic_salary,allowances,deductions,advance_deduction,
  custody_deduction,net_pay,journal_entry_id,payroll_period,created_at,employees(name,department)`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'payroll', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const employeeId = url.searchParams.get('employeeId');
    if (employeeId && !hrUuid.safeParse(employeeId).success) return error('معرف الموظف غير صالح');
    if (from && !hrDate.safeParse(from).success || to && !hrDate.safeParse(to).success) return error('نطاق التاريخ غير صالح');

    let query = getSupabase().from('payroll').select(PAYROLL_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (employeeId) query = query.eq('employee_id', employeeId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const records = (data || []).map((record: Row) => ({
      ...record,
      employee_name: record.employees ? String((record.employees as Row).name) || null : null,
      department: record.employees ? String((record.employees as Row).department) || null : null,
      employees: undefined,
    }));
    return success({ records, total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'payroll', 'create');
    const parsed = payrollBatchSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات دفعة الرواتب غير صالحة');
    const { data, error: rpcError } = await getSupabase().rpc('post_payroll_batch', {
      p_company_id: auth.companyId,
      p_date: parsed.data.date,
      p_employee_ids: parsed.data.employee_ids,
      p_created_by: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success((data as Row)?.records || [], 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
