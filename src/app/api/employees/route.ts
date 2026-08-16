import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { employeeCreateSchema } from '@/lib/hr-validation';

const EMPLOYEE_COLUMNS = 'id,name,phone,email,salary,department,position,hire_date,is_active,branch_id,cost_center_id,created_at';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'employees', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const active = url.searchParams.get('active');
    if (active && !['true', 'false'].includes(active)) return error('مرشح حالة الموظف غير صالح');
    let query = getSupabase().from('employees').select(EMPLOYEE_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (active) query = query.eq('is_active', active === 'true');
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('name').range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    return success({ employees: data || [], total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'employees', 'create');
    const parsed = employeeCreateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الموظف غير صالحة');
    const input = parsed.data;

    // Friendly early feedback; create_employee_atomic repeats this check under
    // an advisory lock so concurrent requests cannot exceed the paid limit.
    const { checkPlanLimit } = await import('@/lib/plan-limits');
    const limitCheck = await checkPlanLimit(auth.companyId, 'employees');
    if (!limitCheck.allowed) return error(limitCheck.message || 'تم الوصول للحد الأقصى من الموظفين', 403);

    const { data, error: rpcError } = await getSupabase().rpc('create_employee_atomic', {
      p_company_id: auth.companyId,
      p_name: input.name,
      p_phone: input.phone || '',
      p_email: input.email || '',
      p_salary: input.salary,
      p_department: input.department || '',
      p_position: input.position || '',
      p_hire_date: input.hire_date,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
