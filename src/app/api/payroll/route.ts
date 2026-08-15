import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

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

    const { data: existingPayroll } = await s.from('payroll')
      .select('employee_id').eq('company_id', auth.companyId).eq('date', date).in('employee_id', employee_ids);
    if (existingPayroll && existingPayroll.length > 0) {
      return error('تم إنشاء راتب لأحد الموظفين في هذا التاريخ مسبقاً');
    }

    // حل الحسابات قبل أي كتابة — القيد إلزامي متوازن
    const { data: salAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.SALARIES_EXPENSE).maybeSingle();
    const { data: accrAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCRUED_SALARIES).maybeSingle();
    const { data: advAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_ADVANCES).maybeSingle();
    if (!salAcc || !accrAcc) {
      return error('حسابات الرواتب (5210) أو الرواتب المستحقة (2140) غير موجودة — راجع دليل الحسابات');
    }

    let totalSalary = 0;
    let totalAdvance = 0;
    const rows: Array<{ empId: string; salary: number; advanceDeduction: number; netPay: number }> = [];

    // احسب كل شيء أولاً (بدون كتابة) — السلف تُقرأ من remaining_amount
    for (const empId of employee_ids) {
      const { data: emp } = await s.from('employees').select('*').eq('id', empId).eq('company_id', auth.companyId).maybeSingle();
      if (!emp) continue;
      const salary = parseFloat(emp.salary) || 0;

      const { data: advRows } = await s.from('employee_advances')
        .select('id, amount, remaining_amount')
        .eq('employee_id', empId)
        .eq('company_id', auth.companyId)
        .gt('remaining_amount', 0);
      const advanceBalance = (advRows || []).reduce((s: number, r: any) => s + (parseFloat(r.remaining_amount) || 0), 0);
      const advanceDeduction = Math.min(advanceBalance, salary * 0.5);
      const netPay = salary - advanceDeduction;

      rows.push({ empId, salary, advanceDeduction, netPay });
      totalSalary += salary;
      totalAdvance += advanceDeduction;
    }

    if (rows.length === 0) return error('لا يوجد موظفون صالحون للترحيل');

    // القيد: مدين مصروف الرواتب / دائن المستحق + سلف الموظفين
    const { createJournalEntry } = await import('@/lib/journal-utils');
    const lines: Array<{ account_id: string; debit: number; credit: number }> = [
      { account_id: salAcc.id, debit: totalSalary, credit: 0 },
      { account_id: accrAcc.id, debit: 0, credit: totalSalary - totalAdvance },
    ];
    if (totalAdvance > 0) {
      if (!advAcc) return error('حساب سلف الموظفين (1160) غير موجود');
      lines.push({ account_id: advAcc.id, debit: 0, credit: totalAdvance });
    }

    const je = await createJournalEntry(auth.companyId, {
      date, type: 'general', description: `رواتب شهر ${date.substring(0, 7)}`, created_by: auth.userId, lines,
    });
    if (je.error || !je.journalId) throw je.error || new Error('فشل قيد الرواتب');
    const jeId = je.journalId;

    // الآن اكتب سجلات الرواتب وخفض أرصدة السلف. نحتفظ بالأرصدة الأصلية
    // كي يكون التراجع كاملاً إذا فشل إدخال موظف لاحق في الدفعة.
    const created: any[] = [];
    const deductedAdvances: Array<{ id: string; remaining: number }> = [];
    try {
      for (const r of rows) {
        const { data: pr, error: prErr } = await s.from('payroll')
          .insert({ company_id: auth.companyId, employee_id: r.empId, date, basic_salary: r.salary, allowances: 0, deductions: 0, advance_deduction: r.advanceDeduction, net_pay: r.netPay, journal_entry_id: jeId })
          .select('*').single();
        if (prErr) throw prErr;
        created.push(pr);

        // خفض رصيد السلف (FIFO) بدلاً من عمود type غير الموجود
        if (r.advanceDeduction > 0) {
          const { data: advRows } = await s.from('employee_advances')
            .select('id, remaining_amount')
            .eq('employee_id', r.empId)
            .eq('company_id', auth.companyId)
            .gt('remaining_amount', 0)
            .order('date');
          let left = r.advanceDeduction;
          for (const adv of advRows || []) {
            if (left <= 0) break;
            const rem = parseFloat(adv.remaining_amount) || 0;
            const deduct = Math.min(rem, left);
            const { error: advanceUpdateError } = await s.from('employee_advances')
              .update({ remaining_amount: rem - deduct })
              .eq('id', adv.id)
              .eq('company_id', auth.companyId);
            if (advanceUpdateError) throw advanceUpdateError;
            deductedAdvances.push({ id: adv.id, remaining: rem });
            left -= deduct;
          }
        }
      }
    } catch (writeErr) {
      // تراجع كامل: استعد أرصدة السلف ثم احذف سجلات الرواتب والقيد.
      for (const advance of deductedAdvances.reverse()) {
        await s.from('employee_advances')
          .update({ remaining_amount: advance.remaining })
          .eq('id', advance.id)
          .eq('company_id', auth.companyId);
      }
      await s.from('payroll').delete().eq('journal_entry_id', jeId).eq('company_id', auth.companyId);
      await s.from('journal_lines').delete().eq('journal_entry_id', jeId).eq('company_id', auth.companyId);
      await s.from('journal_entries').delete().eq('id', jeId).eq('company_id', auth.companyId);
      throw writeErr;
    }

    return success(created, 201);
  } catch (err) { return handleApiError(err); }
}
