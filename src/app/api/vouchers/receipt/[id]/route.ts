import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { resolveAccountId, postReversalEntry, revertInvoiceAllocations } from '@/lib/voucher-utils';
import { voucherUpdateSchema } from '@/lib/validation';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

function receiptCounterpartCode(receiptType: string): string {
  switch (receiptType) {
    case 'client': return ACCOUNT_CODES.ACCOUNTS_RECEIVABLE;
    case 'supplier_refund': return ACCOUNT_CODES.ACCOUNTS_PAYABLE;
    case 'general':
    default: return ACCOUNT_CODES.OTHER_REVENUE;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireModulePermission(request, 'receipts', 'read');
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_receipts')
      .select('*, contacts!contact_id(name), banks_safes!bank_safe_id(name), journal_entries!journal_entry_id(number)')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: invoiceItems } = await s.from('receipt_invoice_items')
      .select('*, invoices!invoice_id(number)')
      .eq('voucher_receipt_id', id);

    return success({
      ...(voucher as Record<string, any>),
      contact_name: (voucher as Record<string, any>).contacts?.name || null,
      bank_safe_name: (voucher as Record<string, any>).banks_safes?.name || null,
      journal_entry_number: (voucher as Record<string, any>).journal_entries?.number || null,
      invoice_items: (invoiceItems || []).map((ri: any) => ({
        ...ri,
        invoice_number: ri.invoices?.number || null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/vouchers/receipt/[id]
 * تعديل سند = عكس القيد القديم (يبقى للتدقيق) + قيد جديد بالقيم الجديدة.
 * لا قيد غير متوازن أبداً: الحساب المقابل إلزامي الحل قبل أي كتابة.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();
    const body = await parseBody(request);

    const parsed = voucherUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { data: oldVoucher } = await s.from('voucher_receipts')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!oldVoucher) return notFound();
    const old = oldVoucher as any;
    if (old.status === 'cancelled') return error('السند ملغى ولا يمكن تعديله');

    // لا تعديل لسند مربوط بحركات نقدية (حارس موجود — يبقى)
    const { data: depRes } = await s.from('cash_transactions')
      .select('id').eq('voucher_receipt_id', id).limit(1);
    if (depRes && depRes.length > 0) {
      return error('لا يمكن تعديل سند القبض لأنه مرتبط بحركات نقدية');
    }

    // لا تعديل لسند عليه تخصيصات فواتير (تعقيد الاسترجاع) — أنشئ سنداً جديداً
    const { data: allocRes } = await s.from('receipt_invoice_items')
      .select('id').eq('voucher_receipt_id', id).limit(1);
    if (allocRes && allocRes.length > 0) {
      return error('لا يمكن تعديل سند مخصص على فواتير — ألغِ السند وأنشئ سنداً جديداً');
    }

    const newDate = parsed.data.date || old.date;
    const newAmount = parsed.data.amount ?? parseFloat(old.amount);
    const newBankSafeId = parsed.data.bank_safe_id || old.bank_safe_id;
    const newReason = parsed.data.reason || old.reason;
    const newContactId = parsed.data.contact_id !== undefined ? parsed.data.contact_id : old.contact_id;

    // انتماء الخزينة والطرف للشركة
    const { data: bankAccount } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', newBankSafeId)
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    if (!bankAccount?.account_id) return error('البنك/الخزينة غير موجود', 404);

    if (newContactId) {
      const { data: contact } = await s.from('contacts')
        .select('id').eq('id', newContactId).eq('company_id', ctx.companyId).maybeSingle();
      if (!contact) return error('الطرف المحدد غير موجود', 404);
    }

    const counterpartAccountId = await resolveAccountId(ctx.companyId, receiptCounterpartCode(old.receipt_type));
    if (!counterpartAccountId) return error('الحساب المقابل غير موجود — راجع شجرة الحسابات', 400);

    // 1. عكس القيد القديم (يبقى الأصل في الدفاتر)
    if (old.journal_entry_id) {
      const { error: revErr } = await postReversalEntry(ctx.companyId, {
        journalEntryId: old.journal_entry_id,
        referenceType: 'voucher_receipt_reversal',
        referenceId: id,
        description: `عكس سند قبض رقم ${old.number} (تعديل)`,
        userId: ctx.userId,
      });
      if (revErr) throw revErr;
    }

    // 2. قيد جديد بالقيم المعدَّلة
    const { journalId, error: journalError } = await createJournalEntry(ctx.companyId, {
      date: newDate,
      type: 'general',
      description: `سند قبض رقم ${old.number}: ${newReason}`,
      lines: [
        { account_id: bankAccount.account_id, debit: newAmount, credit: 0 },
        { account_id: counterpartAccountId, debit: 0, credit: newAmount, contact_id: newContactId || null },
      ],
      reference_type: 'voucher_receipt',
      reference_id: id,
      created_by: ctx.userId,
    });
    if (journalError) throw journalError;

    const { data: updated, error: updateErr } = await s.from('voucher_receipts')
      .update({
        date: newDate,
        contact_id: newContactId,
        amount: newAmount,
        bank_safe_id: newBankSafeId,
        reason: newReason,
        journal_entry_id: journalId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/vouchers/receipt/[id]
 * إلغاء ناعم: استرجاع التخصيصات + قيد عكسي + status='cancelled'.
 * القيد الأصلي والسند يبقيان للتدقيق — لا حذف مادي لأثر مالي.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_receipts')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();
    if ((voucher as any).status === 'cancelled') return error('السند ملغى مسبقاً');

    const { data: depRes } = await s.from('cash_transactions')
      .select('id').eq('voucher_receipt_id', id).limit(1);
    if (depRes && depRes.length > 0) {
      return error('لا يمكن إلغاء سند القبض لأنه مرتبط بحركات نقدية');
    }

    // استرجاع تخصيصات الفواتير (يعيد paid_amount/status كما كانت)
    await revertInvoiceAllocations(ctx.companyId, 'receipt', id);

    // قيد عكسي — الأصل يبقى
    if ((voucher as any).journal_entry_id) {
      const { error: revErr } = await postReversalEntry(ctx.companyId, {
        journalEntryId: (voucher as any).journal_entry_id,
        referenceType: 'voucher_receipt_reversal',
        referenceId: id,
        description: `عكس سند قبض رقم ${(voucher as any).number} (إلغاء)`,
        userId: ctx.userId,
      });
      if (revErr) throw revErr;
    }

    const { error: updErr } = await s.from('voucher_receipts')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', ctx.companyId);
    if (updErr) throw updErr;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
