import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
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
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { date, employee_ids } = data;
    if (!date || !employee_ids || employee_ids.length === 0)
      return error('date, employee_ids are required');

    const { data: salAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.SALARIES_EXPENSE).maybeSingle();
    const { data: accrAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCRUED_SALARIES).maybeSingle();
    const { data: advAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_ADVANCES).maybeSingle();

    const { data: maxJe } = await s.from('journal_entries').select('number').eq('company_id', auth.companyId).order('number', { ascending: false }).limit(1).maybeSingle();
    const jeNum = ((maxJe as any)?.number || 0) + 1;
    const { data: je } = await s.from('journal_entries')
      .insert({ company_id: auth.companyId, number: jeNum, date, type: 'general', description: `رواتب شهر ${date.substring(0, 7)}`, created_by: auth.userId })
      .select('id').single();
    const jeId = je.id;

    let totalSalary = 0, totalAdvance = 0;
    const created: any[] = [];

    for (const empId of employee_ids) {
      const { data: emp } = await s.from('employees').select('*').eq('id', empId).maybeSingle();
      if (!emp) continue;
      const salary = parseFloat(emp.salary) || 0;

      const { data: advRows } = await s.from('employee_advances').select('type, amount').eq('employee_id', empId).eq('company_id', auth.companyId);
      const advanceBalance = (advRows || []).reduce((s: number, r: any) => {
        return s + (r.type === 'advance' ? (parseFloat(r.amount) || 0) : -(parseFloat(r.amount) || 0));
      }, 0);
      const advanceDeduction = Math.min(advanceBalance, salary * 0.5);
      const netPay = salary - advanceDeduction;

      const { data: pr } = await s.from('payroll')
        .insert({ company_id: auth.companyId, employee_id: empId, date, basic_salary: salary, allowances: 0, deductions: 0, advance_deduction: advanceDeduction, net_pay: netPay, journal_entry_id: jeId })
        .select('*').single();
      created.push(pr);
      totalSalary += salary;

      if (advanceDeduction > 0) {
        await s.from('employee_advances').insert({ company_id: auth.companyId, employee_id: empId, date, type: 'deduction', amount: advanceDeduction, description: 'تسديد سلفة من الراتب' });
        totalAdvance += advanceDeduction;
      }
    }

    const jl: any[] = [];
    if (salAcc) jl.push({ journal_entry_id: jeId, account_id: salAcc.id, debit: totalSalary, credit: 0 });
    if (accrAcc) jl.push({ journal_entry_id: jeId, account_id: accrAcc.id, debit: 0, credit: totalSalary - totalAdvance });
    if (advAcc && totalAdvance > 0) jl.push({ journal_entry_id: jeId, account_id: advAcc.id, debit: 0, credit: totalAdvance });
    if (jl.length > 0) await s.from('journal_lines').insert(jl);

    return success(created, 201);
  } catch (err) { return handleApiError(err); }
}
