import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, notFound, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const { data, error: queryError } = await s.from('employees').select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError || !data) return notFound();
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const data = await parseBody(req);
    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.salary !== undefined) updateData.salary = data.salary;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.position !== undefined) updateData.position = data.position;
    if (data.hire_date !== undefined) updateData.hire_date = data.hire_date;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    const { data: result, error: updateError } = await s.from('employees')
      .update(updateData).eq('id', id).eq('company_id', auth.companyId).select('*').maybeSingle();
    if (updateError) throw updateError;
    if (!result) return notFound();
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const { data: payroll } = await s.from('payroll').select('id').eq('employee_id', id).limit(1);
    const { data: vouchers } = await s.from('voucher_disbursements').select('id').eq('employee_id', id).limit(1);
    const { data: advances } = await s.from('employee_advances').select('id').eq('employee_id', id).limit(1);
    if ((payroll?.length || 0) + (vouchers?.length || 0) + (advances?.length || 0) > 0)
      return error('لا يمكن حذف موظف لديه سجلات مرتبطة');
    const { error: deleteError } = await s.from('employees').delete().eq('id', id);
    if (deleteError) throw deleteError;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
