import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError, getPaginationParams, getDateRangeParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextVoucherNumber, getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';
import { getAccountBalanceFromJournal } from '@/lib/journal-utils';
import { requireModulePermission } from '@/lib/permissions';
import { canBypassTelegramConfirmation } from '@/lib/permissions';

const sb = () => getSupabase();

/**
 * GET /api/vouchers/receipt
 * Fixed to properly handle errors instead of swallowing them
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const receiptType = url.searchParams.get('receiptType');

    let query = s.from('voucher_receipts')
      .select(`
        *,
        contacts(name),
        employees(name),
        banks_safes(name),
        journal_entries(number)
      `, { count: 'exact' })
      .eq('company_id', auth.companyId);
    
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (receiptType) query = query.eq('receipt_type', receiptType);

    const offset = (page - 1) * pageSize;
    const result = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (result.error) {
      console.error('Receipt fetch error:', result.error);
      throw result.error;
    }

    return success({
      receipts: result.data || [],
      total: result.count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((result.count || 0) / pageSize),
    });
  } catch (err) {
    console.error('Receipt GET error:', err);
    return handleApiError(err);
  }
}

/**
 * POST /api/vouchers/receipt
 * Create receipt with proper validation
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    const {
      date,
      receiptType,
      contactId,
      amount,
      bankSafeId,
      reason,
    } = body;

    if (!date || !receiptType || !amount || !bankSafeId || !reason) {
      return error('جميع الحقول المطلوبة يجب تعبئتها', 400);
    }

    if (parseFloat(amount) <= 0) {
      return error('المبلغ يجب أن يكون أكبر من صفر', 400);
    }

    // Get bank safe info
    const { data: bankSafe } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', bankSafeId)
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
        receipt_type: receiptType,
        contact_id: contactId || null,
        amount: parseFloat(amount),
        bank_safe_id: bankSafeId,
        reason,
        created_by: auth.userId,
        status: 'approved',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (receiptError) throw receiptError;

    // Create journal entry
    const { data: journal, error: journalError } = await insertJournalLines(
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
            bank_safe_id: bankSafeId,
            contact_id: contactId || null,
          },
          {
            account_id: getAccountCode(receiptType),
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
 * DELETE /api/vouchers/receipt/[id]/route.ts
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    // Delete receipt
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