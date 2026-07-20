import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, requireModulePermission, handleApiError, requireManagerOrAbove } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextVoucherNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { requireApproval } from '@/lib/notifications';
import { checkTransactionBeforeSave } from '@/lib/approval-helpers';
import { createJournalEntry, getAccountBalanceFromJournal } from '@/lib/journal-utils';
import { canBypassTelegramConfirmation } from '@/lib/permissions';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'disbursements', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const disbType = url.searchParams.get('disbursementType');

    let data, count, queryError;
    try {
      let query = s.from('voucher_disbursements')
        .select('*, contacts(name), employees(name), banks_safes(name), journal_entries(number)', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (disbType) query = query.eq('disbursement_type', disbType);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      count = result.count;
      queryError = result.error;
    } catch (joinErr) {
      console.warn('Disbursement GET with joins failed, trying simple:', joinErr);
      let query = s.from('voucher_disbursements')
        .select('*', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (disbType) query = query.eq('disbursement_type', disbType);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      count = result.count;
      queryError = result.error;
    }

    if (queryError) throw queryError;

    return success({
      vouchers: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireManagerOrAbove(request);
    const s = sb();
    const body = await parseBody<any>(request);

    const {
      date,
      disbursementType,
      contactId,
      employeeId,
      amount,
      bankSafeId,
      reason,
    } = body;

    if (!date || !disbursementType || !amount || !bankSafeId || !reason) {
      return error('جميع الحقول المطلوبة يجب تعبئتها');
    }

    // 1. التحقق من الموافقة المسبقة من التيليغرام
    const bypassApproval = await canBypassTelegramConfirmation(auth.userId, auth.companyId);
    if (!bypassApproval) {
      // إنشاء معرّف مؤقت للمعاملة للتحقق من الاعتماد
      const tempTransactionId = crypto.randomUUID();
      
      const approvalCheck = await checkTransactionBeforeSave(
        auth.companyId,
        auth.userId,
        Number(amount),
        'voucher_disbursement',
        tempTransactionId,
        reason
      );
      
      if (approvalCheck.blocked) {
        // المعاملة محظورة - نحفظها بحالة pending فقط
        // لكننا لا نكمل إنشاء القيد المحاسبي
        return success({
          requiresApproval: true,
          blocked: true,
          message: approvalCheck.message,
          transactionId: tempTransactionId
        });
      }
    }

    // 2. التحقق من الرصيد
    const { data: bankSafe } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', bankSafeId)
      .eq('company_id', auth.companyId)
      .single();

    if (!bankSafe) {
      return error('البنك/الخزينة غير موجود');
    }

    if (bankSafe.account_id) {
      const balance = await getAccountBalanceFromJournal(bankSafe.account_id, auth.companyId);
      if (balance < Number(amount)) {
        return error(`الرصيد غير كافٍ. الرصيد الحالي: ${balance.toFixed(2)} ر.س`);
      }
    }

    // 3. إنشاء سند الصرف
    const nextNumber = await getNextVoucherNumber('voucher_disbursement', auth.companyId);
    const transactionId = crypto.randomUUID();

    const { data: voucher, error: voucherError } = await s.from('voucher_disbursements')
      .insert({
        company_id: auth.companyId,
        number: nextNumber,
        date,
        disbursement_type: disbursementType,
        contact_id: contactId || null,
        employee_id: employeeId || null,
        amount: Number(amount),
        bank_safe_id: bankSafeId,
        reason,
        created_by: auth.userId,
        status: 'approved', // الوضع الافتراضي إذا لم يكن محتاجاً لاعتماد
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (voucherError) throw voucherError;

    // 4. إنشاء القيد المحاسبي
    const debitAccountId = bankSafe.account_id;
    let creditAccountId = ACCOUNT_CODES.CASH_ON_HAND;

    if (disbursementType === 'supplier') {
      creditAccountId = ACCOUNT_CODES.ACCOUNTS_PAYABLE;
    } else if (disbursementType === 'employee_advance') {
      creditAccountId = ACCOUNT_CODES.EMPLOYEE_ADVANCES;
    } else if (disbursementType === 'subcontractor') {
      creditAccountId = ACCOUNT_CODES.SUBCONTRACTORS_PAYABLE;
    }

    const { error: journalError } = await createJournalEntry(
      auth.companyId,
      {
        date,
        type: 'general',
        description: `سند صرف رقم ${nextNumber}: ${reason}`,
        lines: [
          {
            account_id: debitAccountId,
            debit: Number(amount),
            credit: 0,
            bank_safe_id: bankSafeId,
          },
          {
            account_id: creditAccountId,
            debit: 0,
            credit: Number(amount),
          },
        ],
        reference_type: 'voucher_disbursement',
        reference_id: (voucher as any).id,
        created_by: auth.userId,
      }
    );

    if (journalError) throw journalError;

    // 5. إرسال إشعار التيليغرام (اختياري)
    await requireApproval(auth.companyId, Number(amount), 'voucher_disbursement', auth.userId, (voucher as any).id, reason);

    return success(voucher, 201);
  } catch (err) {
    return handleApiError(err);
  }
}