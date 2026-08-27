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

import type { Row, SupabaseLike } from './types';

const sb = () => getSupabase();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type VoucherKind = 'receipt' | 'disbursement';

/** إن فشل embed الأسماء، املأها من جداول الأطراف. */
export async function hydratePartyNames(
  supabase: SupabaseLike,
  companyId: string,
  rows: Row[],
  opts: { contacts?: boolean; employees?: boolean } = {},
): Promise<Row[]> {
  if (!rows.length) return rows;
  if (opts.contacts) {
    const ids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))];
    if (ids.length) {
      const { data } = await supabase.from('contacts').select('id, name').eq('company_id', companyId).in('id', ids);
      const map = new Map((data || []).map((c: Row) => [c.id, c.name]));
      for (const r of rows) {
        if (!r.contacts && r.contact_id) r.contacts = { name: map.get(r.contact_id) || '' };
        const contact = (r.contacts ?? null) as Row | null;
    r.contact_name = contact?.name || map.get(String(r.contact_id)) || '';
      }
    }
  }
  if (opts.employees) {
    const ids = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))];
    if (ids.length) {
      const { data } = await supabase.from('employees').select('id, name').eq('company_id', companyId).in('id', ids);
      const map = new Map((data || []).map((e: Row) => [e.id, e.name]));
      for (const r of rows) {
        if (!r.employees && r.employee_id) r.employees = { name: map.get(r.employee_id) || '' };
        const employee = (r.employees ?? null) as Row | null;
    r.employee_name = employee?.name || map.get(String(r.employee_id)) || '';
      }
    }
  }
  return rows;
}

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
  return data?.id == null ? null : String(data.id);
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
): Promise<{ error: unknown | null }> {
  const s = sb();
  const { data, error } = await s.rpc('post_journal_reversal', {
    p_company_id: companyId,
    p_journal_entry_id: opts.journalEntryId,
    p_reference_type: opts.referenceType,
    p_reference_id: opts.referenceId,
    p_description: opts.description,
    p_user_id: opts.userId,
  });
  if (error || !data) return { error: error || new Error('فشل إنشاء القيد العكسي') };
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

  if (!Number.isFinite(voucherAmount) || voucherAmount <= 0 ||
      allocations.some((a) => !a.invoice_id || !Number.isFinite(a.amount) || a.amount <= 0 || Math.abs(a.amount * 100 - Math.round(a.amount * 100)) > 1e-8)) {
    return { error: 'بيانات تخصيص الفواتير غير صالحة', applied: 0 };
  }
  if (new Set(allocations.map((a) => a.invoice_id)).size !== allocations.length) {
    return { error: 'لا يمكن تخصيص الفاتورة نفسها أكثر من مرة في السند', applied: 0 };
  }
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

    const total = round2(parseFloat(String(invoice.total)) || 0);
    const paid = round2(parseFloat(String(invoice.paid_amount)) || 0);
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
    const invoiceId = (link as Row)[linkInvoiceCol];
    const { data: invoice } = await s.from(invoiceTable)
      .select('id, total, paid_amount, status')
      .eq('id', invoiceId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!invoice || invoice.status === 'cancelled') continue;

    const total = round2(parseFloat(String(invoice.total)) || 0);
    const newPaid = round2(Math.max(0, (parseFloat(String(invoice.paid_amount)) || 0) - (parseFloat(String(link.amount)) || 0)));
    const newStatus = newPaid <= 0 ? 'unpaid' : (newPaid >= total - 0.005 ? 'paid' : 'partial');

    await s.from(invoiceTable)
      .update({ paid_amount: newPaid, status: newStatus })
      .eq('id', invoiceId)
      .eq('company_id', companyId);
  }

  await s.from(linkTable).delete().eq(linkVoucherCol, voucherId);
}

/**
 * تخصيص FIFO: أقدم فاتورة غير مسددة أولاً.
 * لا يغيّر رصيد 1130 — يحدّث فقط paid_amount/status.
 */
export async function allocateOldestUnpaidInvoices(
  companyId: string,
  voucherId: string,
  journalEntryId: string | null,
  amount: number,
  contactId: string
): Promise<{ error: string | null; applied: number }> {
  const s = sb();
  const { data: invoices } = await s.from('invoices')
    .select('id, total, paid_amount, status, date, number')
    .eq('company_id', companyId)
    .eq('contact_id', contactId)
    .neq('status', 'cancelled')
    .neq('status', 'paid')
    .order('date', { ascending: true })
    .order('number', { ascending: true });

  const allocations: AllocationInput[] = [];
  let remaining = round2(amount);
  for (const inv of invoices || []) {
    if (remaining <= 0.005) break;
    const total = round2(parseFloat(String(inv.total)) || 0);
    const paid = round2(parseFloat(String(inv.paid_amount)) || 0);
    const due = round2(total - paid);
    if (due <= 0) continue;
    const take = round2(Math.min(remaining, due));
    allocations.push({ invoice_id: String(inv.id), amount: take });
    remaining = round2(remaining - take);
  }
  if (allocations.length === 0) return { error: null, applied: 0 };
  return applyInvoiceAllocations(companyId, 'receipt', voucherId, journalEntryId, amount, allocations, contactId);
}
