/**
 * دوال أرصدة وقيود الأطراف (عملاء/موردين/مقاولي باطن)
 *
 * النموذج المحاسبي المعتمد في النظام: حسابات تحكم موحّدة (1130 للعملاء،
 * 2110 للموردين) مع وسم contact_id على سطور القيد. لا تنشئ الأطراف حسابات
 * فرعية خاصة بها. لذلك تُحسب أرصدة الأطراف من سطور journal_lines الموسومة
 * بـ contact_id (مقيدة بالشركة) — وليس من account_id.
 */

import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { resolveAccountId } from '@/lib/voucher-utils';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

const sum = (rows: any[] | null, col: 'debit' | 'credit') =>
  (rows || []).reduce((acc, l: any) => acc + (parseFloat(l[col]) || 0), 0);

/**
 * الرصيد الموقّع للطرف = مجموع (مدين − دائن) لكل سطور القيد الموسومة بـ contact_id.
 * عميل: الموجب = مدين لنا (ذمم مدينة مستحقة). مورد: السالب = دائن/مستحق له.
 */
export async function getContactBalance(companyId: string, contactId: string): Promise<number> {
  const s = sb();
  const { data: lines } = await s.from('journal_lines')
    .select('debit, credit')
    .eq('company_id', companyId)
    .eq('contact_id', contactId);
  return sum(lines, 'debit') - sum(lines, 'credit');
}

/**
 * نسخة دفعية لأرصدة عدة أطراف (لتجنب N+1 في القوائم).
 * تعيد خريطة contactId → رصيد موقّع.
 */
export async function getContactBalances(
  companyId: string,
  contactIds: string[]
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  if (!contactIds || contactIds.length === 0) return map;
  const s = sb();
  const { data: lines } = await s.from('journal_lines')
    .select('contact_id, debit, credit')
    .eq('company_id', companyId)
    .in('contact_id', contactIds);
  for (const l of lines || []) {
    if (!l.contact_id) continue;
    map[l.contact_id] = (map[l.contact_id] || 0) + (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0);
  }
  return map;
}

/**
 * كود الحساب التحكمي للطرف حسب نوعه.
 */
export function contactControlCode(type: string): string {
  return (type === 'supplier' || type === 'subcontractor')
    ? ACCOUNT_CODES.ACCOUNTS_PAYABLE // 2110
    : ACCOUNT_CODES.ACCOUNTS_RECEIVABLE; // 1130 (client / both)
}

/**
 * ترحيل رصيد افتتاحي لطرف كقيد متوازن:
 * - مدين: يُخصم حساب التحكم (الطرف مدين لنا) / دائن رأس المال.
 * - دائن: يُعزَل حساب التحكم / مدين رأس المال.
 * يُوسم سطر حساب التحكم بـ contact_id ليدخل في رصيد الطرف. يتطلب حساب رأس
 * المال (3100) وحساب التحكم، وإلا يفشل صراحةً (لا قيد غير متوازن).
 */
export async function postContactOpeningBalance(
  companyId: string,
  opts: {
    contactId: string;
    type: string;
    amount: number;
    balanceType: 'debit' | 'credit';
    name: string;
    userId: string;
  }
): Promise<{ journalId: string | null; error: any | null }> {
  const amount = Math.abs(opts.amount || 0);
  if (amount === 0) return { journalId: null, error: null };

  const controlAccountId = await resolveAccountId(companyId, contactControlCode(opts.type));
  const capitalAccountId = await resolveAccountId(companyId, ACCOUNT_CODES.CAPITAL);
  if (!controlAccountId) {
    return { journalId: null, error: new Error(`حساب التحكم للطرف (${contactControlCode(opts.type)}) مفقود`) };
  }
  if (!capitalAccountId) {
    return { journalId: null, error: new Error('حساب رأس المال (3100) مفقود — لا يمكن ترحيل رصيد افتتاحي متوازن') };
  }

  const desc = `رصيد افتتاحي - ${opts.name}`;
  const isDebit = opts.balanceType === 'debit';
  const lines = isDebit
    ? [
        { account_id: controlAccountId, debit: amount, credit: 0, contact_id: opts.contactId, description: desc },
        { account_id: capitalAccountId, debit: 0, credit: amount, description: desc },
      ]
    : [
        { account_id: controlAccountId, debit: 0, credit: amount, contact_id: opts.contactId, description: desc },
        { account_id: capitalAccountId, debit: amount, credit: 0, description: desc },
      ];

  const today = new Date().toISOString().split('T')[0];
  return createJournalEntry(companyId, {
    date: today,
    type: 'opening_balance',
    description: desc,
    lines,
    reference_type: 'contact_opening_balance',
    reference_id: opts.contactId,
    created_by: opts.userId,
  });
}
