import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError, getPaginationParams, getDateRangeParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextVoucherNumber } from '@/lib/numbering';
import { createJournalEntry } from '@/lib/journal-utils';
import { resolveAccountId, applyInvoiceAllocations, allocateOldestUnpaidInvoices, revertInvoiceAllocations, hydratePartyNames } from '@/lib/voucher-utils';
import { receiptVoucherCreateSchema } from '@/lib/validation';
import { ACCOUNT_CODES } from '@/lib/constants';
import { canBypassTelegramConfirmation } from '@/lib/permissions';

const sb = () => getSupabase();

/**
 * كود الحساب الدائن المقابل لسند القبض (يُحلَّل إلى معرف فعلي في POST —
 * تمرير الكود كـ account_id كان يبني قيوداً تنهار مع إنفاذ القسم 3)
 */
function receiptCounterpartCode(receiptType: string): string {
  switch (receiptType) {
    case 'client': return ACCOUNT_CODES.ACCOUNTS_RECEIVABLE;      // تخفيض ذمم العميل
    case 'supplier_refund': return ACCOUNT_CODES.ACCOUNTS_PAYABLE; // عكس سداد مورد
    case 'general':
    default: return ACCOUNT_CODES.OTHER_REVENUE;                   // إيراد متنوع
  }
}

/**
 * GET /api/vouchers/receipt
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'receipts', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const receiptType = url.searchParams.get('receiptType');

    // SECURITY: Validate receiptType against an allowlist before interpolating
    // it into the PostgREST `.or()` filter. Unvalidated user input here is a
    // PostgREST filter-injection vector that could widen the filter to other
    // companies' rows.
    const RECEIPT_TYPE_WHITELIST = new Set(['client', 'supplier_refund', 'general']);
    const safeReceiptType = receiptType && RECEIPT_TYPE_WHITELIST.has(receiptType) ? receiptType : null;

    const offset = (page - 1) * pageSize;

    // الملغاة لا تظهر في القوائم — عكس قيدها محفوظ في الدفاتر
    const result = await s.from('voucher_receipts')
      .select(`
        *,
        contacts(name),
        banks_safes(name),
        journal_entries(number)
      `, { count: 'exact' })
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled')
      .gte('date', from || '1970-01-01')
      .lte('date', to || '2999-12-31')
      .or(safeReceiptType ? `receipt_type.eq.${safeReceiptType}` : 'receipt_type.neq.null')
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
        .neq('status', 'cancelled')
        .gte('date', from || '1970-01-01')
        .lte('date', to || '2999-12-31')
        .or(safeReceiptType ? `receipt_type.eq.${safeReceiptType}` : 'receipt_type.neq.null')
        .order('date', { ascending: false })
        .order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (fallbackResult.error) throw fallbackResult.error;
      data = fallbackResult.data;
      count = fallbackResult.count || 0;
    }

    const receipts = await hydratePartyNames(s, auth.companyId, data || [], { contacts: true });

    return success({
      receipts,
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
 * سند قبض: يضيف مالاً للخزينة — لا فحص رصيد هنا (كان فحصاً منسوخاً من الصرف
 * يمنع القبض المشروع عند رصيد منخفض). القيد: مدين الخزينة / دائن المقابل
 * المحلول لمعرف فعلي. التخصيص على فواتير العميل اختياري ومُحصَّن بالمتبقي.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'receipts', 'create');
    const s = sb();
    const body = await request.json();

    // توافقية مزدوجة: camelCase → snake_case قبل التحقق
    const normalized = {
      date: body.date,
      receipt_type: body.receipt_type || body.receiptType,
      contact_id: body.contact_id || body.contactId || null,
      amount: typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount,
      bank_safe_id: body.bank_safe_id || body.bankSafeId,
      reason: body.reason,
      invoice_items: body.invoice_items || body.invoiceItems || undefined,
    };

    const parsed = receiptVoucherCreateSchema.safeParse(normalized);
    if (!parsed.success) return error(parsed.error.issues[0].message, 400);

    const { date, receipt_type, contact_id, amount, bank_safe_id, reason, invoice_items } = parsed.data;

    // الخزينة/البنك: انتماء للشركة + حساب محاسبي مربوط (القيد يحتاجه)
    const { data: bankSafe } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', bank_safe_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!bankSafe) return error('البنك/الخزينة غير موجود', 404);

    // الطرف (عميل/مورد) يجب أن ينتمي للشركة
    if (contact_id) {
      const { data: contact } = await s.from('contacts')
        .select('id').eq('id', contact_id).eq('company_id', auth.companyId).maybeSingle();
      if (!contact) return error('الطرف المحدد غير موجود', 404);
    }

    // بوابة الاعتماد عبر تيليجرام (كما كانت — لا إزالة لميزة موجودة)
    const canBypass = await canBypassTelegramConfirmation(auth.userId, auth.companyId);
    if (!canBypass) {
      const { data: config } = await s.from('company_telegram_configs')
        .select('approvals_enabled, approval_threshold')
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (config && config.approvals_enabled && amount > (config.approval_threshold || 0)) {
        return error('هذه العملية تتطلب اعتماد تيليجرام تقديراً لإدارة النظام', 400);
      }
    }

    // حل الحسابات: خزينة + مقابل — الفشل هنا صريح قبل أي كتابة
    const counterpartAccountId = await resolveAccountId(auth.companyId, receiptCounterpartCode(receipt_type));
    if (!bankSafe.account_id || !counterpartAccountId) {
      return error('الحسابات المحاسبية للسند غير مكتملة (حساب الخزينة أو الحساب المقابل مفقود) — راجع شجرة الحسابات', 400);
    }

    const nextNumber = await getNextVoucherNumber(auth.companyId, 'voucher_receipts');
    const receiptDate = new Date(date).toISOString().split('T')[0];

    let receiptId: string | null = null;
    let journalEntryId: string | null = null;

    try {
      const { data: receipt, error: receiptError } = await s.from('voucher_receipts')
        .insert({
          company_id: auth.companyId,
          number: nextNumber,
          date: receiptDate,
          receipt_type,
          contact_id: contact_id || null,
          amount,
          bank_safe_id,
          reason,
          created_by: auth.userId,
          status: 'approved',
        })
        .select()
        .single();
      if (receiptError) throw receiptError;
      receiptId = receipt.id;

      // القيد: مدين الخزينة (المبلغ داخل) / دائن المقابل
      const { journalId, error: journalError } = await createJournalEntry(
        auth.companyId,
        {
          date: receiptDate,
          type: 'general',
          description: `سند قبض رقم ${nextNumber}: ${reason}`,
          lines: [
            { account_id: bankSafe.account_id, debit: amount, credit: 0 },
            { account_id: counterpartAccountId, debit: 0, credit: amount, contact_id: contact_id || null },
          ],
          reference_type: 'voucher_receipt',
          reference_id: receipt.id,
          created_by: auth.userId,
        }
      );
      if (journalError) throw journalError;
      journalEntryId = journalId;

      await s.from('voucher_receipts')
        .update({ journal_entry_id: journalEntryId })
        .eq('id', receiptId);

      // Open Items: الفاتورة لا تتغير إلا بتخصيص صريح.
      // سند بلا invoice_items = دفعة مقدمة / رصيد غير مخصص — الفواتير تبقى كما هي.
      let applied = 0;
      if (invoice_items && invoice_items.length > 0) {
        const alloc = await applyInvoiceAllocations(
          auth.companyId, 'receipt', receiptId, journalEntryId, amount, invoice_items, contact_id || null
        );
        if (alloc.error) throw new Error(alloc.error);
        applied = alloc.applied;
      } else if (receipt_type === 'client' && contact_id) {
        const { data: fifoSetting } = await s.from('settings')
          .select('value')
          .eq('company_id', auth.companyId)
          .eq('key', 'auto_allocate_receipts_fifo')
          .maybeSingle();
        const fifoOn = fifoSetting && ['true', '1', 'yes'].includes(String(fifoSetting.value).toLowerCase());
        if (fifoOn) {
          const alloc = await allocateOldestUnpaidInvoices(
            auth.companyId, receiptId, journalEntryId, amount, contact_id
          );
          if (alloc.error) throw new Error(alloc.error);
          applied = alloc.applied;
        }
      }

      return success({
        ...receipt,
        journal_entry_id: journalEntryId,
        allocated_amount: applied,
        unapplied_amount: Math.round((amount - applied + Number.EPSILON) * 100) / 100,
      }, 201);
    } catch (txErr) {
      console.error('Receipt creation failed, rolling back:', txErr);
      try {
        if (journalEntryId) {
          await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId).eq('company_id', auth.companyId);
        }
        if (receiptId) {
          // استرجاع أي تخصيصات طُبقت على الفواتير قبل حذف السند
          await revertInvoiceAllocations(auth.companyId, 'receipt', receiptId);
          await s.from('voucher_receipts').delete().eq('id', receiptId).eq('company_id', auth.companyId);
        }
      } catch (rollbackErr) {
        console.error('Receipt rollback failed:', rollbackErr);
      }
      throw txErr;
    }
  } catch (err) {
    console.error('Receipt creation error:', err);
    return handleApiError(err);
  }
}
