/**
 * دوال مساعدة للتعامل مع القيود المحاسبية
 * تضمن إدراج سطور القيود بالحقول المطلوبة بالكامل
 */

import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

interface JournalLineInput {
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description?: string | null;
  project_id?: string | null;
  contact_id?: string | null;
}

/**
 * إدراج سطور قيد محاسبي مع جميع الحقول المطلوبة
 * يقوم تلقائياً بجلب account_code و account_name من جدول الحسابات
 */
export async function insertJournalLines(
  companyId: string,
  lines: JournalLineInput[]
): Promise<{ error: any | null }> {
  const s = sb();

  // جلب بيانات الحسابات لجميع السطور دفعة واحدة
  const accountIds = [...new Set(lines.map(l => l.account_id))];
  const { data: accounts, error: accErr } = await s.from('accounts')
    .select('id, code, name')
    .in('id', accountIds);

  if (accErr) return { error: accErr };

  const accMap = new Map((accounts || []).map((a: any) => [a.id, a]));

  // بناء السطور بالحقول المطلوبة
  const linesToInsert = lines.map(line => {
    const acc = accMap.get(line.account_id);
    return {
      company_id: companyId,
      journal_entry_id: line.journal_entry_id,
      account_id: line.account_id,
      account_code: acc?.code || '0000',
      account_name: acc?.name || 'حساب غير معروف',
      debit: line.debit || 0,
      credit: line.credit || 0,
      description: line.description || null,
      project_id: line.project_id || null,
      contact_id: line.contact_id || null,
    };
  });

  const { error: insertErr } = await s.from('journal_lines').insert(linesToInsert);
  return { error: insertErr };
}

/**
 * حذف جميع سطور والقيد المحاسبي مع التعامل مع القيود المرتبطة
 * يحذف بشكل آمن: سطور القيد أولاً ثم القيد نفسه
 */
export async function deleteJournalEntry(
  companyId: string,
  journalEntryId: string
): Promise<{ error: any | null; message?: string }> {
  const s = sb();

  // حذف سطور القيد أولاً
  const { error: linesErr } = await s.from('journal_lines')
    .delete()
    .eq('journal_entry_id', journalEntryId);
  
  if (linesErr) return { error: linesErr, message: 'فشل حذف سطور القيد' };

  // حذف القيد نفسه
  const { error: entryErr } = await s.from('journal_entries')
    .delete()
    .eq('id', journalEntryId)
    .eq('company_id', companyId);
  
  if (entryErr) return { error: entryErr, message: 'فشل حذف القيد' };

  return { error: null };
}

/**
 * حساب رصيد حساب معين من القيود المحاسبية
 * الرصيد = إجمالي المدين - إجمالي الدائن
 */
export async function getAccountBalanceFromJournal(
  accountId: string
): Promise<number> {
  const s = sb();

  const { data: lines } = await s.from('journal_lines')
    .select('debit, credit')
    .eq('account_id', accountId);

  if (!lines || lines.length === 0) return 0;

  const totalDebit = lines.reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum: number, l: any) => sum + (parseFloat(l.credit) || 0), 0);

  return totalDebit - totalCredit;
}

/**
 * إنشاء قيد محاسبي كامل مع السطور
 * هذه الدالة تنشئ القيد والسطور معاً
 */
export async function createJournalEntry(
  companyId: string,
  {
    date,
    type,
    description,
    lines,
    reference_type,
    reference_id,
    created_by,
  }: {
    date: string;
    type: string;
    description: string;
    lines: Array<{
      account_id: string;
      debit: number;
      credit: number;
      description?: string | null;
      project_id?: string | null;
      contact_id?: string | null;
      bank_safe_id?: string | null;
    }>;
    reference_type?: string | null;
    reference_id?: string | null;
    created_by?: string;
  }
): Promise<{ journalId: string; error: any | null }> {
  const s = sb();

  try {
    // إنشاء القيد المحاسبي
    const journalNumber = await getNextJournalNumber(companyId, date);
    const { data: journal, error: journalError } = await s.from('journal_entries')
      .insert({
        company_id: companyId,
        number: journalNumber,
        date,
        type,
        description,
        reference_type,
        reference_id,
        created_by,
      })
      .select('id')
      .single();

    if (journalError) throw journalError;

    // إنشاء السطور
    const { error: linesError } = await insertJournalLines(companyId, 
      lines.map(line => ({
        journal_entry_id: journal.id,
        ...line
      }))
    );

    if (linesError) throw linesError;

    return { journalId: journal.id, error: null };
  } catch (error) {
    return { journalId: '', error };
  }
}
