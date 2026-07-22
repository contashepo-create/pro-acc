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

/**
 * GET /api/vouchers/disbursement
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'disbursements', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const disbType = url.searchParams.get('disbursementType');

    const offset = (page - 1) * pageSize;

    const result = await s.from('voucher_disbursements')
      .select('*, contacts(name), employees(name), banks_safes(name), journal_entries(number)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .gte('date', from || '1970-01-01')
      .lte('date', to || '2999-12-31')
      .or(disbType ? `disbursement_type.eq.${disbType}` : 'disbursement_type.neq.null')
      .order('date', { ascending: false })
      .order('number', { ascending: false })
      .range(offset, offset + pageSize - 1);

    let data = result.data;
    let count = result.count || 0;

    if (result.error) {
      console.warn('[Disbursement GET] Joined query failed, falling back to simple select:', result.error);
      const fallbackResult = await s.from('voucher_disbursements')
        .select('*', { count: 'exact' })
        .eq('company_id', auth.companyId)
        .gte('date', from || '1970-01-01')
        .lte('date', to || '2999-12-31')
        .or(disbType ? `disbursement_type.eq.${disbType}` : 'disbursement_type.neq.null')
        .order('date', { ascending: false })
        .order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (fallbackResult.error) throw fallbackResult.error;
      
      data = fallbackResult.data;
      count = fallbackResult.count || 0;
    } else {
      data = joinedData || [];
      count = joinedCount || 0;
    }

    return success({
      vouchers: data || [],
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize) || 1,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/vouchers/disbursement
 * إنشاء سند صرف جديد
 * FIXED: يدعم استقبال كلاً من camelCase و snake_case لتلافي خطأ "جميع الحقول المطلوبة يجب تعبئتها"
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireManagerOrAbove(request);
    const s = sb();
    const body = await parseBody<any>(request);

    const {
      date,
      disbursement_type,
      disbursementType,
      contact_id,
      contactId,
      employee_id,
      employeeId,
      amount,
      bank_safe_id,
      bankSafeId,
      reason,
    } = body;

    // توافقية مزدوجة للمتغيرات (Dual Compatibility)
    const finalDisbType = disbursementType || disbursement_type;
    const finalBankSafeId = bankSafeId || bank_safe_id;
    const finalContactId = contactId || contact_id;
    const finalEmployeeId = employeeId || employee_id;

    if (!date || !finalDisbType || !amount || !finalBankSafeId || !reason) {
      return error('جميع الحقول المطلوبة يجب تعبئتها');
    }

    // 1. التحقق من الموافقة المسبقة من التيليغرام
    const bypassApproval = await canBypassTelegramConfirmation(auth.userId, auth.companyId);
    if (!bypassApproval) {
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
        // حفظ السند مسبقاً في قاعدة البيانات بحالة 'pending' ودون ترحيل القيد ليكون متاحاً للاعتماد
        const nextNumber = await getNextVoucherNumber('voucher_disbursement', auth.companyId);
        await s.from('voucher_disbursements').insert({
          id: tempTransactionId,
          company_id: auth.companyId,
          number: nextNumber,
          date,
          disbursement_type: finalDisbType,
          contact_id: finalContactId || null,
          employee_id: finalEmployeeId || null,
          amount: Number(amount),
          bank_safe_id: finalBankSafeId,
          reason,
          created_by: auth.userId,
          status: 'pending',
          created_at: new Date().toISOString(),
        });

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
      .eq('id', finalBankSafeId)
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
        disbursement_type: finalDisbType,
        contact_id: finalContactId || null,
        employee_id: finalEmployeeId || null,
        amount: Number(amount),
        bank_safe_id: finalBankSafeId,
        reason,
        created_by: auth.userId,
        status: 'approved',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (voucherError) throw voucherError;

    // 4. إنشاء القيد المحاسبي
    const debitAccountId = bankSafe.account_id;
    let creditAccountId = ACCOUNT_CODES.CASH_ON_HAND;

    if (finalDisbType === 'supplier') {
      creditAccountId = ACCOUNT_CODES.ACCOUNTS_PAYABLE;
    } else if (finalDisbType === 'employee_advance') {
      creditAccountId = ACCOUNT_CODES.EMPLOYEE_ADVANCES;
    } else if (finalDisbType === 'subcontractor') {
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
            bank_safe_id: finalBankSafeId,
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
