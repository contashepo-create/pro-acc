/**
 * دوال مساعدة لسندات القبض/الصرف
 *
 * المبادئ المفروضة هنا:
 * 1. لا حذف للقيود المرحَّلة أبداً — الإلغاء/التعديل يتم بقيد عكسي يُبقي
 *    القيد الأصلي في الدفاتر للتدقيق.
 * 2. أكواد الحسابات (مثل 1130) لا تُمرَّر أبداً كـ account_id — تُحلَّل
 *    أولاً إلى معرف الحساب الفعلي ضمن الشركة (إصلاح انهيار ما بعد القسم 3).
 * 3. تخصيص المدفوعات على الفواتير يحدّث ثلاثية (paid_amount/status/total)
 *    ذرّياً مع سطور الربط، والاسترجاع يعكسه تماماً.
 */

import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type VoucherKind = 'receipt' | 'disbursement';

/**
 * تحليل كود حساب ثابت إلى معرف الحساب الفعلي ضمن الشركة.
 * يعيد null إن لم يوجد — على المنادي أن يفشل صراحةً لا أن يكتب قيداً بلا مقابل.
 */
export async function resolveAccountId(companyId: string, code: string): Promise<string | null> {
  const s = sb();
  const { data } = await s.from('accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('code', code)
    .maybeSingle();
  return data?.id || null;
}

/**
 * إنشاء قيد عكسي لقيد موجود مع الإبقاء على الأصل.
 * الأصل لا يُحذف أبداً — هذا هو سجل التدقيق.
 */
export async function postReversalEntry(
  companyId: string,
  opts: {
    journalEntryId: string;
    referenceType: string;
    referenceId: string;
    description: string;
    userId: string;
  }
): Promise<{ error: any | null }> {
  const s = sb();

  const { data: oldLines } = await s.from('journal_lines')
    .select('account_id, debit, credit, description')
    .eq('journal_entry_id', opts.journalEntryId);

  if (!oldLines || oldLines.length === 0) return { error: null }; // لا قيد فعلياً — لا شيء لعكسه

  const today = new Date().toISOString().split('T')[0];
  const revNumber = await getNextJournalNumber(companyId, today);
  const { data: revJe, error: revErr } = await s.from('journal_entries')
    .insert({
      company_id: companyId,
      number: revNumber,
      date: today,
      type: 'general',
      description: opts.description,
      reference_type: opts.referenceType,
      reference_id: opts.referenceId,
      created_by: opts.userId,
    })
    .select('id')
    .single();
  if (revErr) return { error: revErr };

  const { error: linesErr } = await insertJournalLines(
    companyId,
    oldLines.map((l: any) => ({
      journal_entry_id: revJe.id,
      account_id: l.account_id,
      debit: parseFloat(l.credit) || 0, // تبديل مدين/دائن
      credit: parseFloat(l.debit) || 0,
      description: l.description,
    }))
  );
  if (linesErr) return { error: linesErr };

  return { error: null };
}

interface AllocationInput { invoice_id: string; amount: number }

/**
 * تخصيص مبلغ سند على الفواتير:
 * - receipt          → invoices (مبيعات) عبر receipt_invoice_items
 * - disbursement     → purchase_invoices عبر disbursement_invoice_items
 * التخصيص يُحصر بالمتبقي على الفاتورة، ومجموع التخصيصات لا يتجاوز مبلغ السند.
 * يعيد رسالة خطأ عربية عند الفشل — ولا حالة جزئية: عند أي فشل يُبلّغ المنادي ليتراجع.
 */
export async function applyInvoiceAllocations(
  companyId: string,
  kind: VoucherKind,
  voucherId: string,
  journalEntryId: string | null,
  voucherAmount: number,
  allocations: AllocationInput[],
  contactId: string | null
): Promise<{ error: string | null; applied: number }> {
  const s = sb();
  const isReceipt = kind === 'receipt';
  const invoiceTable = isReceipt ? 'invoices' : 'purchase_invoices';
  const linkTable = isReceipt ? 'receipt_invoice_items' : 'disbursement_invoice_items';
  const linkVoucherCol = isReceipt ? 'voucher_receipt_id' : 'voucher_disbursement_id';
  const linkInvoiceCol = isReceipt ? 'invoice_id' : 'purchase_invoice_id';

  const totalAllocated = round2(allocations.reduce((sum, a) => sum + a.amount, 0));
  if (totalAllocated > voucherAmount + 0.001) {
    return { error: 'مجموع التخصيصات أكبر من مبلغ السند', applied: 0 };
  }

  let applied = 0;
  for (const alloc of allocations) {
    const { data: invoice } = await s.from(invoiceTable)
      .select('id, total, paid_amount, status, contact_id, supplier_id')
      .eq('id', alloc.invoice_id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!invoice) return { error: `الفاتورة المحددة غير موجودة`, applied: 0 };
    if (invoice.status === 'cancelled') return { error: 'لا يمكن التخصيص على فاتورة ملغاة', applied: 0 };

    // الفاتورة يجب أن تخص نفس الطرف (عميل السند/مورده)
    const invoiceContact = isReceipt ? invoice.contact_id : invoice.supplier_id;
    if (contactId && invoiceContact && invoiceContact !== contactId) {
      return { error: 'الفاتورة المخصصة لا تخص نفس الطرف المحدد في السند', applied: 0 };
    }

    const total = round2(parseFloat(invoice.total) || 0);
    const paid = round2(parseFloat(invoice.paid_amount) || 0);
    const remaining = round2(total - paid);
    if (remaining <= 0) return { error: 'الفاتورة مسددة بالكامل', applied: 0 };

    const toApply = round2(Math.min(alloc.amount, remaining));
    const newPaid = round2(paid + toApply);
    const newStatus = newPaid >= total - 0.005 ? 'paid' : 'partial';

    const { data: upd, error: updErr } = await s.from(invoiceTable)
      .update({ paid_amount: newPaid, status: newStatus })
      .eq('id', invoice.id)
      .eq('company_id', companyId)
      .select('id')
      .maybeSingle();
    if (updErr || !upd) return { error: 'فشل تحديث الفاتورة المخصصة', applied: 0 };

    const { error: linkErr } = await s.from(linkTable).insert({
      company_id: companyId,
      [linkVoucherCol]: voucherId,
      [linkInvoiceCol]: invoice.id,
      amount: toApply,
      journal_entry_id: journalEntryId,
    });
    if (linkErr) return { error: 'فشل حفظ ربط التخصيص', applied: 0 };

    applied = round2(applied + toApply);
  }

  return { error: null, applied };
}

/**
 * استرجاع تخصيصات سند ملغى/محذوف: يخصم من paid_amount للفواتير ويعيد
 * حساب الحالة (لا يلمس فاتورة ملغاة)، ثم يحذف سطور الربط.
 */
export async function revertInvoiceAllocations(
  companyId: string,
  kind: VoucherKind,
  voucherId: string
): Promise<void> {
  const s = sb();
  const isReceipt = kind === 'receipt';
  const invoiceTable = isReceipt ? 'invoices' : 'purchase_invoices';
  const linkTable = isReceipt ? 'receipt_invoice_items' : 'disbursement_invoice_items';
  const linkVoucherCol = isReceipt ? 'voucher_receipt_id' : 'voucher_disbursement_id';
  const linkInvoiceCol = isReceipt ? 'invoice_id' : 'purchase_invoice_id';

  const { data: links } = await s.from(linkTable)
    .select(`id, amount, ${linkInvoiceCol}`)
    .eq(linkVoucherCol, voucherId);

  for (const link of links || []) {
    const invoiceId = link[linkInvoiceCol];
    const { data: invoice } = await s.from(invoiceTable)
      .select('id, total, paid_amount, status')
      .eq('id', invoiceId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!invoice || invoice.status === 'cancelled') continue;

    const total = round2(parseFloat(invoice.total) || 0);
    const newPaid = round2(Math.max(0, (parseFloat(invoice.paid_amount) || 0) - (parseFloat(link.amount) || 0)));
    const newStatus = newPaid <= 0 ? 'unpaid' : (newPaid >= total - 0.005 ? 'paid' : 'partial');

    await s.from(invoiceTable)
      .update({ paid_amount: newPaid, status: newStatus })
      .eq('id', invoiceId)
      .eq('company_id', companyId);
  }

  await s.from(linkTable).delete().eq(linkVoucherCol, voucherId);
}
