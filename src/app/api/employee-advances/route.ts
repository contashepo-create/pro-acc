import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'employee_advances', 'read');
    const s = sb();
    const {page,pageSize}=getPaginationParams(new URL(request.url));
    const offset=(page-1)*pageSize;
    const { data: advances, error: queryErr, count } = await s.from('employee_advances')
      .select('*, employees(name)',{count:'exact'})
      .eq('company_id', auth.companyId)
      .order('date', { ascending: false })
      .range(offset,offset+pageSize-1);
    if (queryErr) throw queryErr;
    return success({ advances: advances || [], total:count||0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'employee_advances', 'create');
    const s = sb();
    const body = await parseBody<{ employee_id?: string; amount?: number | string; date?: string; reason?: string; bank_safe_id?: string }>(request);

    if (!body.employee_id || !body.amount || !body.bank_safe_id) return error('الموظف والمبلغ والخزينة/البنك مطلوبة');

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) return error('المبلغ غير صالح');

    const date = body.date || new Date().toISOString().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return error('التاريخ غير صالح');
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 2000)) return error('السبب غير صالح');
    const { data: advance, error: rpcErr } = await s.rpc('create_employee_advance', {
      p_company_id: auth.companyId,
      p_employee_id: body.employee_id,
      p_date: date,
      p_amount: amount,
      p_reason: body.reason?.trim() || '',
      p_bank_safe_id: body.bank_safe_id,
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(advance, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
