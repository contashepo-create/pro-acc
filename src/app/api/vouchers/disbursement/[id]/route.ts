import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry, getAccountBalanceFromJournal } from '@/lib/journal-utils';
import { resolveAccountId, postReversalEntry, revertInvoiceAllocations } from '@/lib/voucher-utils';
import { voucherUpdateSchema } from '@/lib/validation';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

function disbursementDebitCode(type: string): string {
  switch (type) {
    case 'supplier': return ACCOUNT_CODES.ACCOUNTS_PAYABLE;
    case 'employee_advance': return ACCOUNT_CODES.EMPLOYEE_ADVANCES;
    case 'subcontractor': return ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES;
    case 'client_refund': return ACCOUNT_CODES.ACCOUNTS_RECEIVABLE;
    case 'other':
    default: return ACCOUNT_CODES.DIRECT_COSTS;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireModulePermission(request, 'disbursements', 'read');
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_disbursements')
      // العمود الصحيح number (كان sequence_number — join ميت يعيد null دائماً)
      .select('*, contacts!contact_id(name), banks_safes!bank_safe_id(name), journal_entries!journal_entry_id(number), employees!employee_id(name)')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: invoiceItems } = await s.from('disbursement_invoice_items')
      .select('*, purchase_invoices!purchase_invoice_id(invoice_number)')
      .eq('voucher_disbursement_id', id);

    return success({
      ...(voucher as Record<string, any>),
      contact_name: (voucher as Record<string, any>).contacts?.name || null,
      bank_safe_name: (voucher as Record<string, any>).banks_safes?.name || null,
      journal_entry_number: (voucher as Record<string, any>).journal_entries?.number || null,
      employee_name: (voucher as Record<string, any>).employees?.name || null,
      invoice_items: (invoiceItems || []).map((di: any) => ({
        ...di,
        invoice_number: di.purchase_invoices?.invoice_number || null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/vouchers/disbursement/[id] — كان مفقوداً كلياً (الصفحة ترسل PUT → 405)
 * تعديل = عكس القيد القديم (يبقى للتدقيق) + قيد جديد بالاتجاه الصحيح.
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

    const { data: oldVoucher } = await s.from('voucher_disbursements')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!oldVoucher) return notFound();
    const old = oldVoucher as Record<string, any>;
    if (old.status === 'cancelled') return error('السند ملغى ولا يمكن تعديله');
    if (old.status === 'pending') return error('السند قيد الاعتماد ولا يمكن تعديله');

    const { data: depRes } = await s.from('cash_transactions')
      .select('id').eq('voucher_disbursement_id', id).limit(1);
    if (depRes && depRes.length > 0) {
      return error('لا يمكن تعديل سند الصرف لأنه مرتبط بحركات نقدية');
    }

    const { data: allocRes } = await s.from('disbursement_invoice_items')
      .select('id').eq('voucher_disbursement_id', id).limit(1);
    if (allocRes && allocRes.length > 0) {
      return error('لا يمكن تعديل سند مخصص على فواتير — ألغِ السند وأنشئ سنداً جديداً');
    }

    const newDate = parsed.data.date || old.date;
    const newAmount = parsed.data.amount ?? parseFloat(old.amount);
    const newBankSafeId = parsed.data.bank_safe_id || old.bank_safe_id;
    const newReason = parsed.data.reason || old.reason;
    const newContactId = parsed.data.contact_id !== undefined ? parsed.data.contact_id : old.contact_id;
    const newEmployeeId = parsed.data.employee_id !== undefined ? parsed.data.employee_id : old.employee_id;

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

    // كفاية الرصيد عند رفع مبلغ الصرف (الصرف يُنقص النقدية)
    if (newAmount > parseFloat(old.amount)) {
      const balance = await getAccountBalanceFromJournal(bankAccount.account_id, ctx.companyId);
      if (balance < newAmount) {
        return error(`الرصيد غير كافٍ. الرصيد الحالي: ${balance.toFixed(2)} ر.س`);
      }
    }

    const counterpartAccountId = await resolveAccountId(ctx.companyId, disbursementDebitCode(old.disbursement_type));
    if (!counterpartAccountId) return error('الحساب المقابل غير موجود — راجع شجرة الحسابات', 400);

    // 1. عكس القيد القديم (الأصل يبقى)
    if (old.journal_entry_id) {
      const { error: revErr } = await postReversalEntry(ctx.companyId, {
        journalEntryId: old.journal_entry_id,
        referenceType: 'voucher_disbursement_reversal',
        referenceId: id,
        description: `عكس سند صرف رقم ${old.number} (تعديل)`,
        userId: ctx.userId,
      });
      if (revErr) throw revErr;
    }

    // 2. قيد جديد بالاتجاه الصحيح: مدين المقابل / دائن الخزينة
    const { journalId, error: journalError } = await createJournalEntry(ctx.companyId, {
      date: newDate,
      type: 'general',
      description: `سند صرف رقم ${old.number}: ${newReason}`,
      lines: [
        { account_id: counterpartAccountId, debit: newAmount, credit: 0, contact_id: newContactId || null },
        { account_id: bankAccount.account_id, debit: 0, credit: newAmount },
      ],
      reference_type: 'voucher_disbursement',
      reference_id: id,
      created_by: ctx.userId,
    });
    if (journalError) throw journalError;

    const { data: updated, error: updateErr } = await s.from('voucher_disbursements')
      .update({
        date: newDate,
        contact_id: newContactId,
        employee_id: newEmployeeId,
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
 * DELETE /api/vouchers/disbursement/[id]
 * إلغاء ناعم: استرجاع تخصيصات فواتير الشراء + قيد عكسي + status='cancelled'.
 * كان يحذف السند والقيد مادياً — تدمير كامل لسجل المدفوعات.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_disbursements')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();
    if ((voucher as Record<string, any>).status === 'cancelled') return error('السند ملغى مسبقاً');

    const { data: depRes } = await s.from('cash_transactions')
      .select('id').eq('voucher_disbursement_id', id).limit(1);
    if (depRes && depRes.length > 0) {
      return error('لا يمكن إلغاء سند الصرف لأنه مرتبط بحركات نقدية');
    }

    // استرجاع التخصيصات على فواتير الشراء قبل العكس
    await revertInvoiceAllocations(ctx.companyId, 'disbursement', id);

    // سلفة موظف مرتبطة: تُزال لأن أساسها أُلغي
    if ((voucher as Record<string, any>).disbursement_type === 'employee_advance' && (voucher as Record<string, any>).journal_entry_id) {
      await s.from('employee_advances')
        .delete()
        .eq('journal_entry_id', (voucher as Record<string, any>).journal_entry_id)
        .eq('company_id', ctx.companyId);
    }

    // قيد عكسي — الأصل يبقى للتدقيق
    if ((voucher as Record<string, any>).journal_entry_id) {
      const { error: revErr } = await postReversalEntry(ctx.companyId, {
        journalEntryId: (voucher as Record<string, any>).journal_entry_id,
        referenceType: 'voucher_disbursement_reversal',
        referenceId: id,
        description: `عكس سند صرف رقم ${(voucher as Record<string, any>).number} (إلغاء)`,
        userId: ctx.userId,
      });
      if (revErr) throw revErr;
    }

    const { error: updErr } = await s.from('voucher_disbursements')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', ctx.companyId);
    if (updErr) throw updErr;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
