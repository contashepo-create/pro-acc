/**
 * دوال مساعدة للتعامل مع القيود المحاسبية
 * تضمن إدراج سطور القيود بالحقول المطلوبة بالكامل
 */

import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber, isUniqueViolation } from '@/lib/numbering';

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
export async function insertJournalHeader(
  companyId: string,
  fields: {
    date: string;
    type: string;
    description?: string | null;
    reference_type?: string | null;
    reference_id?: string | null;
    created_by?: string;
  },
): Promise<{ data: { id: string } | null; error: any | null }> {
  const s = sb();
  const { assertOpenFiscalPeriod } = await import('@/lib/fiscal-guard');
  await assertOpenFiscalPeriod(companyId, fields.date);

  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const number = await getNextJournalNumber(companyId, fields.date);
    const { data, error } = await s.from('journal_entries')
      .insert({
        company_id: companyId,
        number,
        date: fields.date,
        type: fields.type,
        description: fields.description || null,
        reference_type: fields.reference_type || null,
        reference_id: fields.reference_id || null,
        created_by: fields.created_by,
      })
      .select('id')
      .single();
    if (!error && data) return { data, error: null };
    lastError = error;
    if (!isUniqueViolation(error)) return { data: null, error };
  }
  return { data: null, error: lastError };
}

export async function insertJournalLines(
  companyId: string,
  lines: JournalLineInput[]
): Promise<{ error: any | null }> {
  // This helper is used by invoices, vouchers, inventory and fiscal routes.
  // Enforce the posting invariant here too, not only in the manual-journal UI.
  if (lines.length < 2) return { error: new Error('لا يمكن ترحيل قيد بأقل من سطرين') };
  let totalDebit = 0;
  let totalCredit = 0;
  const sides = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const debit = Number(line.debit);
    const credit = Number(line.credit);
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 ||
        (debit === 0 && credit === 0) || (debit > 0 && credit > 0) ||
        Math.abs(debit * 100 - Math.round(debit * 100)) > 1e-8 ||
        Math.abs(credit * 100 - Math.round(credit * 100)) > 1e-8) {
      return { error: new Error('سطر القيد غير صالح: يجب أن يكون مديناً أو دائناً موجباً بمنزلتين عشريتين كحد أقصى') };
    }
    totalDebit += debit;
    totalCredit += credit;
    const side = sides.get(line.account_id) || { debit: 0, credit: 0 };
    side.debit += debit;
    side.credit += credit;
    sides.set(line.account_id, side);
  }
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    return { error: new Error(`القيد غير متزن: المدين ${totalDebit} والدائن ${totalCredit}`) };
  }
  if ([...sides.values()].some((side) => side.debit > 0 && side.credit > 0)) {
    return { error: new Error('لا يجوز أن يكون الحساب نفسه مديناً ودائناً في القيد الواحد') };
  }

  const s = sb();

  // جلب بيانات الحسابات لجميع السطور دفعة واحدة
  // Company scoping is mandatory: never resolve account metadata cross-tenant.
  const accountIds = [...new Set(lines.map(l => l.account_id))];
  const { data: accounts, error: accErr } = await s.from('accounts')
    .select('id, code, name, is_header')
    .in('id', accountIds)
    .eq('company_id', companyId);

  if (accErr) return { error: accErr };

  const accMap = new Map((accounts || []).map((a: any) => [a.id, a]));

  // ACCOUNTING INTEGRITY: a line whose account cannot be resolved must fail
  // loudly — previously it was silently written with code '0000' / 'حساب غير
  // معروف', producing malformed ledger lines that corrupt reports.
  const unresolved = lines.filter(l => !accMap.has(l.account_id));
  if (unresolved.length > 0) {
    return {
      error: new Error(`تعذر العثور على ${unresolved.length} حساب للقيد — تحقق من الحسابات المختارة`),
    };
  }
  if (lines.some((line) => Boolean((accMap.get(line.account_id) as any)?.is_header))) {
    return { error: new Error('لا يجوز الترحيل على حساب رئيسي') };
  }

  // بناء السطور بالحقول المطلوبة
  const linesToInsert = lines.map(line => {
    const acc = accMap.get(line.account_id);
    return {
      company_id: companyId,
      journal_entry_id: line.journal_entry_id,
      account_id: line.account_id,
      account_code: acc?.code,
      account_name: acc?.name,
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
 * حساب رصيد حساب معين من القيود المحاسبية
 * الرصيد = إجمالي المدين - إجمالي الدائن
 */
export async function getAccountBalanceFromJournal(
  accountId: string,
  companyId?: string
): Promise<number> {
  const s = sb();

  if (!companyId) throw new Error('companyId مطلوب لحساب رصيد الحساب بأمان');
  const { data, error } = await s.rpc('get_account_balance', {
    p_company_id: companyId, p_account_id: accountId, p_journal_type: null, p_as_of: null,
  });
  if (error) throw error;
  return Number(data) || 0;
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
  // ACCOUNTING INTEGRITY: فرض قيد مزدوج متوازن (قبل أي وصول لقاعدة البيانات)
  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  if (lines.length === 0) {
    return { journalId: '', error: new Error('لا يمكن إنشاء قيد محاسبي بدون سطور') };
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return {
      journalId: '',
      error: new Error(
        `خطأ في الموازنة: مجموع المدين (${totalDebit}) لا يساوي مجموع الدائن (${totalCredit})`
      ),
    };
  }

  try {
    const s = sb();
    const { data: journal, error: journalError } = await insertJournalHeader(companyId, {
      date, type, description, reference_type, reference_id, created_by,
    });
    if (journalError || !journal) throw journalError || new Error('فشل إنشاء القيد');

    // إنشاء السطور
    const { error: linesError } = await insertJournalLines(companyId,
      lines.map(line => ({
        journal_entry_id: journal.id,
        ...line
      }))
    );

    if (linesError) {
      // تنظيف القيد اليتيم: احذف القيد إن فشل إدراج سطوره
      await s.from('journal_entries').delete().eq('id', journal.id).eq('company_id', companyId);
      throw linesError;
    }

    return { journalId: journal.id, error: null };
  } catch (error) {
    return { journalId: '', error };
  }
}
