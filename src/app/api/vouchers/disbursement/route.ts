import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireModulePermission, handleApiError, requireManagerOrAbove } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextVoucherNumber } from '@/lib/numbering';
import { disbursementVoucherCreateSchema } from '@/lib/validation';
import { ACCOUNT_CODES } from '@/lib/constants';
import { requireApproval } from '@/lib/notifications';
import { checkTransactionBeforeSave } from '@/lib/approval-helpers';
import { createJournalEntry, getAccountBalanceFromJournal } from '@/lib/journal-utils';
import { resolveAccountId, applyInvoiceAllocations, revertInvoiceAllocations } from '@/lib/voucher-utils';
import { canBypassTelegramConfirmation } from '@/lib/permissions';

const sb = () => getSupabase();

/**
 * الحساب المدين المقابل لسند الصرف حسب النوع (حساب البنك دائماً دائن).
 * القاعدة المحاسبية: الصرف يُنقص النقدية (دائن) ويُنقص الالتزام/يزيد الأصل (مدين).
 */
function disbursementDebitCode(type: string): string {
  switch (type) {
    case 'supplier': return ACCOUNT_CODES.ACCOUNTS_PAYABLE;        // سداد ذمم موردين
    case 'employee_advance': return ACCOUNT_CODES.EMPLOYEE_ADVANCES; // سلفة موظف (أصل)
    case 'subcontractor': return ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES; // سداد مقاول باطن
    case 'client_refund': return ACCOUNT_CODES.ACCOUNTS_RECEIVABLE;  // رد مبلغ لعميل
    case 'other':
    default: return ACCOUNT_CODES.DIRECT_COSTS;                     // مصروف مباشر عام
  }
}

/**
 * GET /api/vouchers/disbursement
 * يعيد المفتاحين disbursements و vouchers (الصفحة تقرأ disbursements —
 * كان يُعاد vouchers فقط فتظهر القائمة فارغة دائماً)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'disbursements', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const disbType = url.searchParams.get('disbursementType');

    // SECURITY: Validate disbursementType against an allowlist before
    // interpolating into the PostgREST `.or()` filter to prevent filter
    // injection (cross-company data leak).
    const DISBURSEMENT_TYPE_WHITELIST = new Set(['supplier', 'employee_advance', 'subcontractor', 'client_refund', 'other']);
    const safeDisbType = disbType && DISBURSEMENT_TYPE_WHITELIST.has(disbType) ? disbType : null;

    const offset = (page - 1) * pageSize;

    const result = await s.from('voucher_disbursements')
      .select('*, contacts(name), employees(name), banks_safes(name), journal_entries(number)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled')
      .gte('date', from || '1970-01-01')
      .lte('date', to || '2999-12-31')
      .or(safeDisbType ? `disbursement_type.eq.${safeDisbType}` : 'disbursement_type.neq.null')
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
        .neq('status', 'cancelled')
        .gte('date', from || '1970-01-01')
        .lte('date', to || '2999-12-31')
        .or(safeDisbType ? `disbursement_type.eq.${safeDisbType}` : 'disbursement_type.neq.null')
        .order('date', { ascending: false })
        .order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (fallbackResult.error) throw fallbackResult.error;

      data = fallbackResult.data;
      count = fallbackResult.count || 0;
    }

    return success({
      disbursements: data || [],
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
 * FIXES الجوهرية:
 * - اتجاه القيد كان معكوساً تماماً (البنك مدين +) — الصرف الآن: مدين المقابل /
 *   دائن الخزينة. كل سند سابق كان ينفخ رصيد البنك دفترياً بدل إنقاصه.
 * - الحساب المقابل كان يُمرَّر ككود ('2110') في خانة account_id (انهيار مؤكد
 *   بعد إنفاذ insertJournalLines في القسم 3) — يُحلَّل الآن لمعرف حقيقي.
 * - تحقق Zod + انتماء الأطراف للشركة + تخصيص اختياري على فواتير الشراء.
 * - تدفق اعتماد التيليجرام (pending) محفوظ كما هو.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireManagerOrAbove(request);
    const s = sb();
    const body = await parseBody<any>(request);

    // توافقية مزدوجة: camelCase → snake_case قبل التحقق
    const normalized = {
      date: body.date,
      disbursement_type: body.disbursement_type || body.disbursementType,
      contact_id: body.contact_id || body.contactId || null,
      employee_id: body.employee_id || body.employeeId || null,
      amount: typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount,
      bank_safe_id: body.bank_safe_id || body.bankSafeId,
      reason: body.reason,
      invoice_items: body.invoice_items || body.invoiceItems || undefined,
    };

    const parsed = disbursementVoucherCreateSchema.safeParse(normalized);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { date, disbursement_type, contact_id, employee_id, amount, bank_safe_id, reason, invoice_items } = parsed.data;

    // انتماء الأطراف للشركة (قبل أي كتابة)
    if (contact_id) {
      const { data: contact } = await s.from('contacts')
        .select('id').eq('id', contact_id).eq('company_id', auth.companyId).maybeSingle();
      if (!contact) return error('الطرف المحدد غير موجود', 404);
    }
    if (employee_id) {
      const { data: employee } = await s.from('employees')
        .select('id').eq('id', employee_id).eq('company_id', auth.companyId).maybeSingle();
      if (!employee) return error('الموظف المحدد غير موجود', 404);
    }

    // 1. بوابة الاعتماد المسبق عبر التيليجرام (محفوظة كما هي)
    const bypassApproval = await canBypassTelegramConfirmation(auth.userId, auth.companyId);
    if (!bypassApproval) {
      const tempTransactionId = crypto.randomUUID();

      const approvalCheck = await checkTransactionBeforeSave(
        auth.companyId,
        auth.userId,
        amount,
        'voucher_disbursement',
        tempTransactionId,
        reason
      );

      if (approvalCheck.blocked) {
        // حفظ السند بحالة 'pending' دون ترحيل قيد — يُرحَّل عند الاعتماد
        const nextNumber = await getNextVoucherNumber(auth.companyId, 'voucher_disbursements');
        await s.from('voucher_disbursements').insert({
          id: tempTransactionId,
          company_id: auth.companyId,
          number: nextNumber,
          date,
          disbursement_type,
          contact_id: contact_id || null,
          employee_id: employee_id || null,
          amount,
          bank_safe_id,
          reason,
          created_by: auth.userId,
          status: 'pending',
        });

        return success({
          requiresApproval: true,
          blocked: true,
          message: approvalCheck.message,
          transactionId: tempTransactionId,
        });
      }
    }

    // 2. الخزينة + كفاية الرصيد (الصرف يُنقص النقدية — الفحص هنا صحيح)
    const { data: bankSafe } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', bank_safe_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!bankSafe) return error('البنك/الخزينة غير موجود', 404);

    if (bankSafe.account_id) {
      const balance = await getAccountBalanceFromJournal(bankSafe.account_id, auth.companyId);
      if (balance < amount) {
        return error(`الرصيد غير كافٍ. الرصيد الحالي: ${balance.toFixed(2)} ر.س`);
      }
    }

    const counterpartAccountId = await resolveAccountId(auth.companyId, disbursementDebitCode(disbursement_type));
    if (!bankSafe.account_id || !counterpartAccountId) {
      return error('الحسابات المحاسبية للسند غير مكتملة (حساب الخزينة أو الحساب المقابل مفقود) — راجع شجرة الحسابات', 400);
    }

    // 3. الإنشاء مع تراجع آلي عند أي فشل
    const nextNumber = await getNextVoucherNumber(auth.companyId, 'voucher_disbursements');

    let voucherId: string | null = null;
    let journalEntryId: string | null = null;

    try {
      const { data: voucher, error: voucherError } = await s.from('voucher_disbursements')
        .insert({
          company_id: auth.companyId,
          number: nextNumber,
          date,
          disbursement_type,
          contact_id: contact_id || null,
          employee_id: employee_id || null,
          amount,
          bank_safe_id,
          reason,
          created_by: auth.userId,
          status: 'approved',
        })
        .select()
        .single();
      if (voucherError) throw voucherError;
      voucherId = voucher.id;

      // 4. القيد بالاتجاه الصحيح: مدين المقابل / دائن الخزينة (المال خارج)
      const { journalId, error: journalError } = await createJournalEntry(
        auth.companyId,
        {
          date,
          type: 'general',
          description: `سند صرف رقم ${nextNumber}: ${reason}`,
          lines: [
            { account_id: counterpartAccountId, debit: amount, credit: 0, contact_id: contact_id || null },
            { account_id: bankSafe.account_id, debit: 0, credit: amount },
          ],
          reference_type: 'voucher_disbursement',
          reference_id: voucher.id,
          created_by: auth.userId,
        }
      );
      if (journalError) throw journalError;
      journalEntryId = journalId;

      await s.from('voucher_disbursements')
        .update({ journal_entry_id: journalEntryId })
        .eq('id', voucherId);

      // 5. تخصيص اختياري على فواتير المشتريات غير المسددة
      if (invoice_items && invoice_items.length > 0) {
        const { error: allocErr } = await applyInvoiceAllocations(
          auth.companyId, 'disbursement', voucherId, journalEntryId, amount, invoice_items, contact_id || null
        );
        if (allocErr) throw new Error(allocErr);
      }

      // 6. إشعار التيليجرام (كما كان)
      await requireApproval(auth.companyId, amount, 'voucher_disbursement', auth.userId, voucherId, reason);

      return success({ ...voucher, journal_entry_id: journalEntryId }, 201);
    } catch (txErr) {
      console.error('Disbursement creation failed, rolling back:', txErr);
      try {
        if (journalEntryId) {
          await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId).eq('company_id', auth.companyId);
        }
        if (voucherId) {
          await revertInvoiceAllocations(auth.companyId, 'disbursement', voucherId);
          await s.from('voucher_disbursements').delete().eq('id', voucherId).eq('company_id', auth.companyId);
        }
      } catch (rollbackErr) {
        console.error('Disbursement rollback failed:', rollbackErr);
      }
      throw txErr;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
