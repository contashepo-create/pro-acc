import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

/**
 * POST /api/fiscal/reversing
 * إنشاء قيد عكسي (Reversing Entry) لقيد موجود
 * 
 * القيد العكسي يعكس جميع سطور القيد الأصلي:
 * - المدين يصبح دائن
 * - الدائن يصبح مدين
 * 
 * يُستخدم عادةً في بداية السنة الجديدة لإلغاء قيود الإقفال أو القيود التقديرية
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();
    const { originalEntryId, reverseDate, description } = body;

    if (!originalEntryId) {
      return error('originalEntryId مطلوب');
    }

    // الحصول على القيد الأصلي
    const { data: originalEntry } = await s.from('journal_entries')
      .select('*')
      .eq('id', originalEntryId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!originalEntry) {
      return error('القيد الأصلي غير موجود');
    }

    const oe = originalEntry as any;

    // الحصول على سطور القيد الأصلي
    const { data: originalLines } = await s.from('journal_lines')
      .select('*')
      .eq('journal_entry_id', originalEntryId);

    if (!originalLines || originalLines.length === 0) {
      return error('القيد الأصلي لا يحتوي على سطور');
    }

    // التحقق من أن القيد متوازن
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of originalLines) {
      const l = line as any;
      totalDebit += parseFloat(l.debit) || 0;
      totalCredit += parseFloat(l.credit) || 0;
    }

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return error('القيد الأصلي غير متوازن');
    }

    // تحديد تاريخ القيد العكسي
    const revDate = reverseDate || new Date().toISOString().split('T')[0];

    // إنشاء القيد العكسي
    const jeNum = await getNextJournalNumber(auth.companyId, revDate);
    const { data: reverseEntry } = await s.from('journal_entries')
      .insert({
        company_id: auth.companyId,
        number: jeNum,
        date: revDate,
        type: 'reversing',
        description: description || `قيد عكسي للقيد رقم ${oe.number}`,
        reference_type: 'journal_entry',
        reference_id: originalEntryId,
        created_by: auth.userId,
      })
      .select('id, number, date')
      .single();

    const re = reverseEntry as any;

    // إنشاء السطور العكسية (عكس المدين والدائن)
    const reverseLines = originalLines.map((line: any) => ({
      journal_entry_id: re.id,
      account_id: line.account_id,
      account_code: line.account_code,
      debit: parseFloat(line.credit) || 0,  // العكس: credit -> debit
      credit: parseFloat(line.debit) || 0,   // العكس: debit -> credit
      description: `عكس: ${line.description || ''}`,
    }));

    const { error: linesErr } = await s.from('journal_lines').insert(reverseLines);

    if (linesErr) {
      // التراجع عن إنشاء القيد العكسي
      await s.from('journal_entries').delete().eq('id', re.id);
      throw linesErr;
    }

    // تحديث القيد الأصلي للإشارة إلى القيد العكسي
    await s.from('journal_entries')
      .update({ reversed_by: re.id })
      .eq('id', originalEntryId);

    return success({
      originalEntryId,
      originalEntryNumber: oe.number,
      reverseEntryId: re.id,
      reverseEntryNumber: re.number,
      reverseDate: revDate,
      linesCount: reverseLines.length,
      message: `تم إنشاء قيد عكسي رقم ${re.number} بنجاح`,
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
