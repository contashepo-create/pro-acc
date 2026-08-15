import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { round2 } from '@/lib/custody';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'custodies', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const employeeId = url.searchParams.get('employeeId');
    const status = url.searchParams.get('status');

    let query = s.from('custodies')
      .select('*, employees(name), projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    let { data, error: qErr, count } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (qErr) {
      const fb = await s.from('custodies').select('*', { count: 'exact' }).eq('company_id', auth.companyId)
        .order('date', { ascending: false }).range(offset, offset + pageSize - 1);
      if (fb.error) throw fb.error;
      data = fb.data; count = fb.count; qErr = null;
    }

    const custodies = (data || []).map((c: any) => ({
      ...c,
      employee_name: c.employees?.name || '',
      project_name: c.projects?.name || null,
    }));
    return success({ custodies, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'custodies', 'create');
    const s = sb();
    const body = await parseBody(req);
    const employee_id = body.employee_id;
    const date = body.date;
    const amount = round2(parseFloat(body.amount));
    const bank_safe_id = body.bank_safe_id;
    const project_id = body.project_id || null;
    const reason = body.reason || body.description || 'عهدة موظف';

    if (!employee_id || !date || !amount || amount <= 0) {
      return error('الموظف والتاريخ ومبلغ موجب مطلوبة');
    }
    if (!bank_safe_id) return error('الخزينة/البنك مصدر الصرف مطلوب');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return error('التاريخ غير صالح');
    if (typeof reason !== 'string' || reason.length > 2000) return error('البيان غير صالح');
    const { data: custody, error: rpcErr } = await s.rpc('open_custody_file', {
      p_company_id: auth.companyId,
      p_employee_id: employee_id,
      p_date: date,
      p_amount: amount,
      p_reason: reason.trim(),
      p_bank_safe_id: bank_safe_id,
      p_project_id: project_id,
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(custody, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
