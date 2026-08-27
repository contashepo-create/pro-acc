import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { employeeUpdateSchema, hrUuid } from '@/lib/hr-validation';

import type { Row } from '@/lib/types';

const EMPLOYEE_COLUMNS = 'id,name,phone,email,salary,department,position,hire_date,is_active,branch_id,cost_center_id,created_at';

async function findEmployee(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('employees').select(EMPLOYEE_COLUMNS)
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'employees', 'read');
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف الموظف غير صالح');
    const employee = await findEmployee(auth.companyId, id);
    return employee ? success(employee) : notFound();
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف الموظف غير صالح');
    const parsed = employeeUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الموظف غير صالحة');
    if (!await findEmployee(auth.companyId, id)) return notFound();
    const { data, error: rpcError } = await getSupabase().rpc('update_employee_atomic', {
      p_company_id: auth.companyId,
      p_employee_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف الموظف غير صالح');
    const existing = await findEmployee(auth.companyId, id);
    if (!existing) return notFound();
    if ((existing as Row).is_active === false) return error('الموظف غير نشط بالفعل', 409);
    const { data, error: rpcError } = await getSupabase().rpc('deactivate_employee_atomic', {
      p_company_id: auth.companyId,
      p_employee_id: id,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success({ deactivated: true, employee: data });
  } catch (cause) {
    return handleApiError(cause);
  }
}
