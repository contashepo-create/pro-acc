import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, getPaginationParams, getDateRangeParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextVoucherNumber } from '@/lib/numbering';
import { createJournalEntry, getAccountBalanceFromJournal } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';
import { canBypassTelegramConfirmation } from '@/lib/permissions'; 

const sb = () => getSupabase();

/**
 * Helper function to get account ID based on receipt type
 */
function getAccountCode(receiptType: string): string {
  switch (receiptType) {
    case 'client':
      return ACCOUNT_CODES.ACCOUNTS_RECEIVABLE;
    case 'supplier_refund':
      return ACCOUNT_CODES.ACCOUNTS_PAYABLE;
    case 'general':
      return ACCOUNT_CODES.CASH;
    default:
      return ACCOUNT_CODES.CASH;
  }
}

/**
 * GET /api/vouchers/receipt
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const receiptType = url.searchParams.get('receiptType');

    const offset = (page - 1) * pageSize;

    // محاولة جلب العلاقات أولاً (بدون employees لأنها غير موجودة محاسبياً في سندات القبض)
    const result = await s.from('voucher_receipts')
      .select(`
        *,
        contacts(name),
        banks_safes(name),
        journal_entries(number)
      `, { count: 'exact' })
      .eq('company_id', auth.companyId)
      .gte('date', from || '1970-01-01')
      .lte('date', to || '2999-12-31')
      .or(receiptType ? `receipt_type.eq.${receiptType}` : 'receipt_type.neq.null')
      .order('date', { ascending: false })
      .order('number', { ascending: false })
      .range(offset, offset + pageSize - 1);

    let data = result.data;
    let count = result.count || 0;

    if (result.error) {
      console.warn('[Receipt GET] Joined query failed, falling back to simple select:', result.error);
      const fallbackResult = await s.from('voucher_receipts')
        .select('*', { count: 'exact' })
        .eq('company_id', auth.companyId)
        .gte('date', from || '1970-01-01')
        .lte('date', to || '2999-12-31')
        .or(receiptType ? `receipt_type.eq.${receiptType}` : 'receipt_type.neq.null')
        .order('date', { ascending: false })
        .order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (fallbackResult.error) throw fallbackResult.error;
      data = fallbackResult.data;
      count = fallbackResult.count || 0;
    }

    return success({
      receipts: data || [],
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize) || 1,
    });
  } catch (err) {
    console.error('Receipt GET error:', err);
    return handleApiError(err);
  }
}

/**
 * POST /api/vouchers/receipt
 * إنشاء سند قبض جديد
 * FIXED: يدعم استقبال كلاً من camelCase و snake_case لتلافي خطأ "جميع الحقول المطلوبة يجب تعبئتها"
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    const {
      date,
      receipt_type,
      receiptType,
      contact_id,
      contactId,
      amount,
      bank_safe_id,
      bankSafeId,
      reason,
    } = body;

    // توافقية مزدوجة للمتغيرات (Dual Compatibility)
    const finalReceiptType = receiptType || receipt_type;
    const finalBankSafeId = bankSafeId || bank_safe_id;
    const finalContactId = contactId || contact_id;

    if (!date || !finalReceiptType || !amount || !finalBankSafeId || !reason) {
      return error('جميع الحقول المطلوبة يجب تعبئتها', 400);
    }

    if (parseFloat(amount) <= 0) {
      return error('المبلغ يجب أن يكون أكبر من صفر', 400);
    }

    // Get bank safe info
    const { data: bankSafe } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', finalBankSafeId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!bankSafe) {
      return error('البنك/الخزينة غير موجود', 404);
    }

    // Check account balance
    if (bankSafe.account_id) {
      const balance = await getAccountBalanceFromJournal(bankSafe.account_id, auth.companyId);
      if (balance < parseFloat(amount)) {
        return error(`الرصيد غير كافٍ. الرصيد الحالي: ${balance.toFixed(2)} ر.س، المبلغ المطلوب: ${amount} ر.س`, 400);
      }
    }

    // Check bypass permission
    const canBypass = await canBypassTelegramConfirmation(auth.userId, auth.companyId);
    if (!canBypass) {
      const { data: config } = await s.from('company_telegram_configs')
        .select('approvals_enabled, approval_threshold')
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (config && config.approvals_enabled && parseFloat(amount) > (config.approval_threshold || 0)) {
        return error('هذه العملية تتطلب اعتماد تيليجرام تقديراً لإدارة النظام', 400);
      }
    }

    // Create receipt
    const nextNumber = await getNextVoucherNumber('voucher_receipts', auth.companyId);
    const receiptDate = new Date(date).toISOString().split('T')[0];

    const { data: receipt, error: receiptError } = await s.from('voucher_receipts')
      .insert({
        company_id: auth.companyId,
        number: nextNumber,
        date: receiptDate,
        receipt_type: finalReceiptType,
        contact_id: finalContactId || null,
        amount: parseFloat(amount),
        bank_safe_id: finalBankSafeId,
        reason,
        created_by: auth.userId,
        status: 'approved',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (receiptError) throw receiptError;

    // Create journal entry
    const { error: journalError } = await createJournalEntry(
      auth.companyId,
      {
        date: receiptDate,
        type: 'general',
        description: `سند قبض رقم ${nextNumber}: ${reason}`,
        lines: [
          {
            account_id: bankSafe.account_id,
            debit: parseFloat(amount),
            credit: 0,
            bank_safe_id: finalBankSafeId,
            contact_id: finalContactId || null,
          },
          {
            account_id: getAccountCode(finalReceiptType),
            debit: 0,
            credit: parseFloat(amount),
          },
        ],
        reference_type: 'voucher_receipt',
        reference_id: (receipt as any).id,
        created_by: auth.userId,
      }
    );

    if (journalError) throw journalError;

    return success(receipt, 201);
  } catch (err) {
    console.error('Receipt creation error:', err);
    return handleApiError(err);
  }
}

/**
 * DELETE /api/vouchers/receipt/[id]
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { error: deleteError } = await s.from('voucher_receipts')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);

    if (deleteError) throw deleteError;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
