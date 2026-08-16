import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { employeeAdvanceCreateSchema } from '@/lib/hr-validation';

const ADVANCE_COLUMNS = `id,employee_id,amount,remaining_amount,date,reason,journal_entry_id,
  voucher_disbursement_id,custody_id,type,status,approved_at,created_at,employees(name)`;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'employee_advances', 'read');
    const { page, pageSize } = getPaginationParams(new URL(request.url));
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await getSupabase().from('employee_advances')
      .select(ADVANCE_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId)
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const advances = (data || []).map((advance: any) => ({
      ...advance, employee_name: advance.employees?.name || '', employees: undefined,
    }));
    return success({ advances, total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'employee_advances', 'create');
    const parsed = employeeAdvanceCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات السلفة غير صالحة');
    const input = parsed.data;
    const { data: advance, error: rpcError } = await getSupabase().rpc('create_employee_advance', {
      p_company_id: auth.companyId,
      p_employee_id: input.employee_id,
      p_date: input.date || new Date().toISOString().slice(0, 10),
      p_amount: input.amount,
      p_reason: input.reason || '',
      p_bank_safe_id: input.bank_safe_id,
      p_created_by: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(advance, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
