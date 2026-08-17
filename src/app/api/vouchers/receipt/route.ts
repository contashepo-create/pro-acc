import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError, getPaginationParams, getDateRangeParams, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hydratePartyNames } from '@/lib/voucher-utils';
import { receiptVoucherCreateSchema } from '@/lib/validation';
import { canBypassTelegramConfirmation } from '@/lib/permissions';
import { checkApprovalThreshold, sendApprovalRequestNotification, type ApprovalThresholdResult } from '@/lib/notifications';

const sb = () => getSupabase();

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
    const body = await parseBody<Record<string, unknown>>(request);

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

    const canBypass = await canBypassTelegramConfirmation(auth.userId, auth.companyId);
    const threshold: ApprovalThresholdResult = canBypass
      ? { requiresApproval: false }
      : await checkApprovalThreshold(auth.companyId, amount, 'voucher_receipt', auth.userId);

    let autoFifo = false;
    if ((!invoice_items || invoice_items.length === 0) && receipt_type === 'client' && contact_id) {
      const { data: setting, error: settingErr } = await s.from('settings')
        .select('value').eq('company_id', auth.companyId).eq('key', 'auto_allocate_receipts_fifo').maybeSingle();
      if (settingErr) throw settingErr;
      autoFifo = !!setting && ['true', '1', 'yes'].includes(String(setting.value).toLowerCase());
    }

    // Numbering, voucher, journal, explicit/FIFO allocation, invoice states
    // and audit commit in one database transaction.
    const { data, error: createErr } = await s.rpc('create_voucher_receipt_atomic', {
      p_company_id: auth.companyId,
      p_date: date,
      p_receipt_type: receipt_type,
      p_contact_id: contact_id || null,
      p_amount: amount,
      p_bank_safe_id: bank_safe_id,
      p_reason: reason,
      p_allocations: invoice_items || [],
      p_auto_fifo: autoFifo,
      p_request_approval: threshold.requiresApproval,
      p_user_id: auth.userId,
    });
    if (createErr) throw createErr;
    const voucher = data as Record<string, any>;
    if (voucher.requires_approval) {
      // If the policy lookup itself was unavailable, do not immediately repeat
      // the same failing lookup inside Telegram delivery. The pending voucher
      // is already safely persisted and remains unposted until approval.
      let notificationSent = false;
      if (!threshold.configurationUnavailable) {
        notificationSent = true;
        try {
          await sendApprovalRequestNotification(
            auth.companyId, amount, 'voucher_receipt', voucher.id,
            auth.userId, voucher.approval_id,
          );
        } catch (notifyErr) {
          notificationSent = false;
          console.error('Receipt approval persisted but Telegram delivery failed:', notifyErr);
        }
      }
      return success({
        requiresApproval: true,
        blocked: true,
        message: notificationSent
          ? 'تم إرسال طلب الاعتماد. العملية محظورة حتى الموافقة.'
          : 'تم حفظ طلب الاعتماد، لكن تعذر إرسال إشعار تيليجرام؛ يمكن اعتماده من شاشة الموافقات.',
        transactionId: voucher.id,
        approvalId: voucher.approval_id,
      }, 201);
    }
    return success(voucher, 201);
  } catch (err) {
    console.error('Receipt creation error:', err);
    return handleApiError(err);
  }
}
