import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import {
  loadCustodyFile, assertFileOpen, resolveCustodyAccounts, recordCustodyTx, syncCustodyTotals, round2,
} from '@/lib/custody';

/**
 * إغلاق ملف عهدة — يتطلب confirm: true
 * المتبقي بعد المصروفات:
 *   مرتجع نقدي → مدين الصندوق / دائن 1150
 *   عجز بعد المرتجع → مدين 1160 سلفة / دائن 1150 + سجل سلفة على الراتب
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'custodies', 'approve');
    const { id } = await params;
    const data = await parseBody(req);

    if (data.confirm !== true) {
      return error('إغلاق الملف يتطلب تأكيداً صريحاً (confirm: true)');
    }

    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return error('ملف العهدة غير موجود', 404);
    assertFileOpen(file);

    const date = data.date || new Date().toISOString().split('T')[0];
    const returnedCash = round2(parseFloat(data.returned_cash) || 0);
    const remaining = file.remaining_amount;
    if (returnedCash < 0) return error('المرتجع لا يكون سالباً');
    if (returnedCash > remaining + 0.005) {
      return error(`المرتجع (${returnedCash}) أكبر من المتبقي في الملف (${remaining})`);
    }

    const shortage = round2(remaining - returnedCash);
    const acc = await resolveCustodyAccounts(auth.companyId);
    const s = getSupabase();

    let bankAccountId: string | null = null;
    const bankSafeId = data.bank_safe_id || file.bank_safe_id;
    if (returnedCash > 0) {
      if (!bankSafeId) return error('حدد الخزينة لاستلام المرتجع');
      const { data: bank } = await s.from('banks_safes').select('account_id').eq('id', bankSafeId).eq('company_id', auth.companyId).maybeSingle();
      if (!bank?.account_id) return error('حساب الخزينة غير موجود');
      bankAccountId = bank.account_id;
    }
    if (shortage > 0 && !acc.advanceId) {
      return error('حساب سلف الموظفين (1160) مطلوب لتسجيل العجز');
    }

    const lines: Array<{ account_id: string; debit: number; credit: number; description: string }> = [];
    if (returnedCash > 0 && bankAccountId) {
      lines.push({ account_id: bankAccountId, debit: returnedCash, credit: 0, description: 'مرتجع نقدي من العهدة' });
      lines.push({ account_id: acc.custodyId, debit: 0, credit: returnedCash, description: 'إقفال مرتجع عهدة' });
    }
    if (shortage > 0 && acc.advanceId) {
      lines.push({ account_id: acc.advanceId, debit: shortage, credit: 0, description: 'عجز عهدة — سلفة على الراتب' });
      lines.push({ account_id: acc.custodyId, debit: 0, credit: shortage, description: 'إقفال عجز عهدة' });
    }

    let journalId: string | null = null;
    if (lines.length > 0) {
      const posted = await createJournalEntry(auth.companyId, {
        date, type: 'general',
        description: `إغلاق عهدة ${file.file_number || id}`,
        reference_type: 'custody_close',
        reference_id: id,
        created_by: auth.userId,
        lines,
      });
      if (posted.error || !posted.journalId) throw posted.error || new Error('فشل قيد الإغلاق');
      journalId = posted.journalId;
    }

    if (returnedCash > 0) {
      await recordCustodyTx(auth.companyId, id, 'return', returnedCash, 'مرتجع عند الإغلاق', auth.userId);
    }
    if (shortage > 0) {
      await recordCustodyTx(auth.companyId, id, 'shortage', shortage, 'عجز يُخصم من الراتب', auth.userId);
      try {
        await s.from('employee_advances').insert({
          company_id: auth.companyId,
          employee_id: file.employee_id,
          date,
          type: 'custody_shortage',
          amount: shortage,
          description: `عجز عهدة ${file.file_number || id}`,
          custody_id: id,
        });
      } catch { /* أعمدة اختيارية */ }
    }

    await s.from('custodies').update({
      status: 'settled',
      remaining_amount: 0,
      settlement_amount: returnedCash,
      settlement_date: date,
      settlement_description: data.description || 'إغلاق مؤكد',
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('company_id', auth.companyId);

    return success({
      id,
      status: 'settled',
      returned_cash: returnedCash,
      shortage,
      journal_entry_id: journalId,
      message: shortage > 0
        ? `أُغلق الملف. عجز ${shortage} سلفة على راتب الموظف`
        : 'أُغلق الملف دون عجز',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
