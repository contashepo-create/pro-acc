import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'employee_advances', 'read');
    const s = sb();

    const { data: advances } = await s.from('employee_advances')
      .select('*, employees(name)')
      .eq('company_id', auth.companyId)
      .order('date', { ascending: false });

    return success({ advances: advances || [] });
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

    // عزل مستأجرين: الموظف يجب أن ينتمي لهذه الشركة
    const { data: employee } = await s.from('employees')
      .select('id').eq('id', body.employee_id).eq('company_id', auth.companyId).maybeSingle();
    if (!employee) return error('الموظف غير موجود', 404);

    const { data: bankSafe } = await s.from('banks_safes').select('account_id')
      .eq('id', body.bank_safe_id).eq('company_id', auth.companyId).maybeSingle();
    const { data: advanceAccount } = await s.from('accounts').select('id')
      .eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_ADVANCES).maybeSingle();
    if (!bankSafe?.account_id || !advanceAccount?.id) return error('حساب السلفة أو الخزينة غير موجود', 400);

    const date = body.date || new Date().toISOString().split('T')[0];
    const { data: advance, error: insertErr } = await s.from('employee_advances')
      .insert({
        id: generateId(), company_id: auth.companyId, employee_id: body.employee_id,
        amount, remaining_amount: amount, date, reason: body.reason || null,
      }).select('*').single();
    if (insertErr) throw insertErr;

    const je = await createJournalEntry(auth.companyId, {
      date, type: 'general', description: `سلفة موظف: ${body.reason || ''}`,
      reference_type: 'employee_advance', reference_id: advance.id, created_by: auth.userId,
      lines: [
        { account_id: advanceAccount.id, debit: amount, credit: 0 },
        { account_id: bankSafe.account_id, debit: 0, credit: amount },
      ],
    });
    if (je.error || !je.journalId) {
      await s.from('employee_advances').delete().eq('id', advance.id).eq('company_id', auth.companyId);
      throw je.error || new Error('فشل قيد السلفة');
    }
    const { data: linked, error: linkError } = await s.from('employee_advances')
      .update({ journal_entry_id: je.journalId }).eq('id', advance.id).eq('company_id', auth.companyId).select('*').single();
    if (linkError) throw linkError;
    return success(linked, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
