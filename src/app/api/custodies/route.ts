import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { custodyUuid, openCustodySchema } from '@/lib/custody-validation';

const CUSTODY_COLUMNS = `id,employee_id,amount,remaining_amount,total_received,total_expenses,date,reason,
  description,status,project_id,bank_safe_id,file_number,notes,settlement_amount,settlement_date,
  settlement_description,journal_entry_id,created_at,updated_at,employees(name),projects(name)`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'custodies', 'read');
    const s = getSupabase();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const employeeId = url.searchParams.get('employeeId');
    const status = url.searchParams.get('status');
    if (employeeId && !custodyUuid.safeParse(employeeId).success) return error('معرف الموظف غير صالح');
    if (status && !['open', 'settled', 'shortage'].includes(status)) return error('حالة ملف العهدة غير صالحة');

    let query = s.from('custodies').select(CUSTODY_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId).is('deleted_at', null);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const custodies = (data || []).map((custody: any) => ({
      ...custody,
      employee_name: custody.employees?.name || '',
      project_name: custody.projects?.name || null,
      employees: undefined,
      projects: undefined,
    }));
    return success({ custodies, total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'custodies', 'create');
    const parsed = openCustodySchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات ملف العهدة غير صالحة');
    const input = parsed.data;
    const reason = (input.reason || input.description || 'عهدة موظف').trim() || 'عهدة موظف';
    const { data: custody, error: rpcError } = await getSupabase().rpc('open_custody_file', {
      p_company_id: auth.companyId,
      p_employee_id: input.employee_id,
      p_date: input.date,
      p_amount: input.amount,
      p_reason: reason,
      p_bank_safe_id: input.bank_safe_id,
      p_project_id: input.project_id || null,
      p_created_by: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(custody, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
