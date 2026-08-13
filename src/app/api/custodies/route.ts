import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import {
  resolveCustodyAccounts, nextFileNumber, recordCustodyTx, syncCustodyTotals, round2,
} from '@/lib/custody';

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

    const { data: emp } = await s.from('employees').select('id, name').eq('id', employee_id).eq('company_id', auth.companyId).maybeSingle();
    if (!emp) return error('الموظف غير موجود', 404);
    if (project_id) {
      const { data: p } = await s.from('projects').select('id').eq('id', project_id).eq('company_id', auth.companyId).maybeSingle();
      if (!p) return error('المشروع غير موجود', 404);
    }
    const { data: bank } = await s.from('banks_safes').select('id, account_id').eq('id', bank_safe_id).eq('company_id', auth.companyId).maybeSingle();
    if (!bank?.account_id) return error('الخزينة غير موجودة أو بلا حساب محاسبي', 404);

    const acc = await resolveCustodyAccounts(auth.companyId);
    const fileNumber = await nextFileNumber(auth.companyId);

    const payload: any = {
      company_id: auth.companyId,
      employee_id,
      date,
      amount,
      remaining_amount: amount,
      total_received: amount,
      total_expenses: 0,
      reason,
      description: reason,
      bank_safe_id,
      project_id,
      file_number: fileNumber,
      status: 'open',
      created_by: auth.userId,
    };
    let { data: custody, error: cErr } = await s.from('custodies').insert(payload).select('*').single();
    if (cErr && /column|schema|PGRST|42703/i.test(`${cErr.message} ${cErr.code}`)) {
      delete payload.file_number;
      delete payload.description;
      delete payload.project_id;
      delete payload.total_received;
      delete payload.total_expenses;
      delete payload.created_by;
      const retry = await s.from('custodies').insert(payload).select('*').single();
      custody = retry.data; cErr = retry.error;
    }
    if (cErr || !custody) throw cErr || new Error('فشل إنشاء الملف');

    const { journalId, error: jeErr } = await createJournalEntry(auth.companyId, {
      date,
      type: 'general',
      description: `صرف عهدة ${fileNumber} — ${emp.name}`,
      reference_type: 'custody',
      reference_id: custody.id,
      created_by: auth.userId,
      lines: [
        { account_id: acc.custodyId, debit: amount, credit: 0, description: `عهدة ${emp.name}` },
        { account_id: bank.account_id, debit: 0, credit: amount, description: `صرف عهدة ${fileNumber}` },
      ],
    });
    if (jeErr || !journalId) {
      await s.from('custodies').delete().eq('id', custody.id).eq('company_id', auth.companyId);
      throw jeErr || new Error('فشل قيد صرف العهدة');
    }

    await s.from('custodies').update({ journal_entry_id: journalId }).eq('id', custody.id).eq('company_id', auth.companyId);
    try {
      await recordCustodyTx(auth.companyId, custody.id, 'addition', amount, `افتتاح الملف ${fileNumber}`, auth.userId);
    } catch { /* جدول الحركات قد لا يوجد */ }
    await syncCustodyTotals(auth.companyId, custody.id);

    return success({ ...custody, journal_entry_id: journalId, file_number: fileNumber }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
