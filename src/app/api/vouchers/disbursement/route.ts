import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireModulePermission, handleApiError, requireManagerOrAbove } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { disbursementVoucherCreateSchema } from '@/lib/validation';
import { checkApprovalThreshold, sendApprovalRequestNotification, type ApprovalThresholdResult } from '@/lib/notifications';
import { hydratePartyNames } from '@/lib/voucher-utils';
import { canBypassTelegramConfirmation } from '@/lib/permissions';

const sb = () => getSupabase();

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

    const disbursements = await hydratePartyNames(s, auth.companyId, data || [], { contacts: true, employees: true });

    return success({
      disbursements,
      vouchers: disbursements,
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

    const bypassApproval = await canBypassTelegramConfirmation(auth.userId, auth.companyId);
    const threshold: ApprovalThresholdResult = bypassApproval
      ? { requiresApproval: false }
      : await checkApprovalThreshold(auth.companyId, amount, 'voucher_disbursement', auth.userId);

    // An undirected payment to a supplier/subcontractor is applied to the
    // oldest open purchase invoices by default (FIFO). Disable via the
    // auto_allocate_disbursements_fifo setting = 'false'.
    let autoFifo = true;
    if ((!invoice_items || invoice_items.length === 0)
        && (disbursement_type === 'supplier' || disbursement_type === 'subcontractor') && contact_id) {
      const { data: setting, error: settingErr } = await s.from('settings')
        .select('value').eq('company_id', auth.companyId).eq('key', 'auto_allocate_disbursements_fifo').maybeSingle();
      if (settingErr) throw settingErr;
      if (setting && ['false', '0', 'no'].includes(String(setting.value).toLowerCase())) autoFifo = false;
    }

    // Voucher, number, pending approval/allocation intent OR direct journal and
    // invoice allocation are committed by one authoritative transaction.
    const { data, error: createErr } = await s.rpc('create_voucher_disbursement_atomic', {
      p_company_id: auth.companyId,
      p_date: date,
      p_disbursement_type: disbursement_type,
      p_contact_id: contact_id || null,
      p_employee_id: employee_id || null,
      p_amount: amount,
      p_bank_safe_id: bank_safe_id,
      p_reason: reason,
      p_allocations: invoice_items || [],
      p_request_approval: threshold.requiresApproval,
      p_user_id: auth.userId,
      p_auto_fifo: autoFifo,
    });
    if (createErr) throw createErr;
    const voucher = data as Record<string, any>;
    try {
      const { logAudit } = await import('@/lib/audit');
      await logAudit({
        company_id: auth.companyId, user_id: auth.userId, entity_type: 'voucher_disbursement',
        entity_id: String(voucher.id || ''), action: 'create',
        after: { id: voucher.id, amount, date, disbursement_type, status: voucher.status || 'posted' },
        summary: `سند صرف بقيمة ${amount}${voucher.requires_approval ? ' (بانتظار الاعتماد)' : ''}`,
      });
    } catch (auditError) {
      console.error('Disbursement audit write failed:', auditError);
    }

    if (voucher.requires_approval) {
      let notificationSent = false;
      if (!threshold.configurationUnavailable) {
        notificationSent = true;
        try {
          await sendApprovalRequestNotification(
            auth.companyId, amount, 'voucher_disbursement', voucher.id,
            auth.userId, voucher.approval_id,
          );
        } catch (notifyErr) {
          notificationSent = false;
          console.error('Approval request persisted but Telegram delivery failed:', notifyErr);
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
    return handleApiError(err);
  }
}
