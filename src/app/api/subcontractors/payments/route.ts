import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'subcontractors', 'create');
    const data = await parseBody(req);
    const { contract_id, certificate_id, amount, date, bank_safe_id, notes } = data;

    if (!auth.companyId || !contract_id || !amount || !date || !bank_safe_id) {
      return error('company_id, contract_id, amount, date, bank_safe_id are required');
    }

    const s = sb();

    // عزل مستأجرين: العقد والخزينة يجب أن ينتميا لهذه الشركة (قبل أي كتابة)
    const { data: contract } = await s.from('subcontractor_contracts')
      .select('id').eq('id', contract_id).eq('company_id', auth.companyId).maybeSingle();
    if (!contract) return error('العقد غير موجود', 404);

    const { data: bankAccount } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', bank_safe_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!bankAccount?.account_id) return error('الخزينة/البنك غير موجود أو بلا حساب محاسبي', 404);

    if (certificate_id) {
      const { data: cert } = await s.from('subcontractor_certificates')
        .select('id').eq('id', certificate_id).eq('company_id', auth.companyId).maybeSingle();
      if (!cert) return error('الشهادة غير موجودة', 404);
    }

    // حل حساب الذمم قبل أي كتابة — القيد إلزامي متوازن
    const { data: apAccount } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES)
      .maybeSingle();
    if (!apAccount) return error('حساب مقاولي الباطن (2150) غير موجود — راجع دليل الحسابات');

    // Insert payment
    const { data: payment, error: payErr } = await s.from('subcontractor_payments')
      .insert({
        company_id: auth.companyId,
        contract_id,
        certificate_id: certificate_id || null,
        amount,
        date,
        bank_safe_id,
        notes,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (payErr) throw payErr;

    // القيد: مدين ذمم مقاولي الباطن / دائن الخزينة
    const { createJournalEntry } = await import('@/lib/journal-utils');
    const je = await createJournalEntry(auth.companyId, {
      date,
      type: 'general',
      description: 'دفعة مقاول باطن',
      lines: [
        { account_id: apAccount.id, debit: Number(amount), credit: 0 },
        { account_id: bankAccount.account_id, debit: 0, credit: Number(amount) },
      ],
      reference_type: 'subcontractor_payment',
      reference_id: payment.id,
      created_by: auth.userId,
    });

    if (je.error || !je.journalId) {
      await s.from('subcontractor_payments').delete().eq('id', payment.id).eq('company_id', auth.companyId);
      throw je.error || new Error('فشل قيد دفعة المقاول');
    }

    const { data: linked, error: linkErr } = await s.from('subcontractor_payments')
      .update({ journal_entry_id: je.journalId })
      .eq('id', payment.id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();
    if (linkErr) throw linkErr;

    return success(linked, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
