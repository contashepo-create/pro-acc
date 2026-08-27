import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { initPayment, getPaymentStatus, mapPaymentStatus } from '@/lib/payments/moyasar';
import { generateId } from '@/lib/utils';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

/**
 * GET /api/payments — List all payment records for the company
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'read');
    const s = sb();
    const url = new URL(request.url);
    const invoiceId = url.searchParams.get('invoice_id');

    let query = s.from('payment_records')
      .select('*, invoices(number, total)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .order('created_at', { ascending: false });

    if (invoiceId) {
      query = query.eq('invoice_id', invoiceId);
    }

    const { data, error: qErr, count } = await query.range(0, 49);
    if (qErr) throw qErr;

    return success({ payments: data || [], total: count || 0 });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/payments — Initiate a payment for an invoice
 * Creates a Moyasar payment session and stores the record
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'create');
    const s = sb();
    const body = await parseBody<{
      invoice_id?: string; customer_name?: string; customer_email?: string;
      return_url?: string; bank_safe_id?: string;
    }>(request);
    if (!body.invoice_id) return error('invoice_id مطلوب');

    const { data: invoice, error: invoiceErr } = await s.from('invoices')
      .select('id, number, total, paid_amount, status, contact_id, contacts(name, email)')
      .eq('id', body.invoice_id).eq('company_id', auth.companyId).maybeSingle();
    if (invoiceErr) throw invoiceErr;
    if (!invoice) return error('الفاتورة غير موجودة', 404);
    const inv = invoice as Row;
    if (inv.status === 'paid' || inv.status === 'cancelled') return error('الفاتورة مدفوعة أو ملغاة');
    const amount = Math.round((Number(inv.total) - Number(inv.paid_amount || 0)) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return error('لا يوجد مبلغ متبقٍ للدفع');

    let settlementAccountId: string | null = null;
    if (body.bank_safe_id) {
      const { data: bank, error: bankErr } = await s.from('banks_safes')
        .select('account_id').eq('id', body.bank_safe_id).eq('company_id', auth.companyId).eq('is_active', true).maybeSingle();
      if (bankErr) throw bankErr;
      if (!bank?.account_id) return error('حساب التحصيل غير صالح', 404);
      settlementAccountId = String(bank.account_id);
    }

    const configuredUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
    if (process.env.NODE_ENV === 'production' && !configuredUrl) throw new Error('NEXT_PUBLIC_APP_URL is required');
    const trusted = configuredUrl ? new URL(configuredUrl) : request.nextUrl;
    if (process.env.NODE_ENV === 'production' && trusted.protocol !== 'https:') throw new Error('NEXT_PUBLIC_APP_URL must use HTTPS');
    if (body.return_url) {
      const requested = new URL(body.return_url, trusted.origin);
      if (requested.origin !== trusted.origin) return error('عنوان العودة غير مسموح', 400);
    }

    const name = String(body.customer_name || (inv.contacts ? (inv.contacts as Row).name ?? '' : '') || 'عميل');
    const email = String(body.customer_email || (inv.contacts ? (inv.contacts as Row).email ?? '' : '') || '');
    let gateway: { paymentId: string; paymentUrl: string | null };
    let manual = false;
    try {
      gateway = await initPayment({
        amount,
        description: `دفعة فاتورة رقم ${inv.number}`,
        callbackUrl: `${trusted.origin}/invoices?payment=callback`,
        invoiceId: String(inv.id),
        customerName: name,
        customerEmail: email,
      });
    } catch (gatewayErr) {
      console.warn('Moyasar unavailable; creating an explicitly manual pending record:', gatewayErr);
      manual = true;
      gateway = { paymentId: `manual_${crypto.randomUUID()}`, paymentUrl: null };
    }

    const recordId = generateId();
    const { error: insertErr } = await s.from('payment_records').insert({
      id: recordId,
      company_id: auth.companyId,
      invoice_id: inv.id,
      payment_gateway_id: gateway.paymentId,
      amount,
      currency: 'SAR',
      status: 'pending',
      customer_name: name,
      customer_email: email,
      payment_url: gateway.paymentUrl,
      settlement_account_id: settlementAccountId,
      notes: manual ? 'Manual payment — gateway unavailable' : null,
      created_by: auth.userId,
    });
    // Never turn a DB persistence failure into an unrelated manual payment.
    if (insertErr) throw insertErr;

    return success({
      paymentId: gateway.paymentId,
      paymentUrl: gateway.paymentUrl,
      recordId,
      amount,
      invoiceNumber: inv.number,
      ...(manual ? { message: 'تم إنشاء سجل دفع يدوي معلق؛ يجب تسويته بسند قبض معتمد.' } : {}),
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/payments?id=... — Update payment status (used by webhook)
 */
export async function PUT(request: NextRequest) {
  try {
    // Payment status is a financial authority. An invoice editor must never be
    // able to mark a payment as paid by posting a client-controlled status.
    const auth = await requireManagerOrAbove(request);
    const s = sb();
    const url = new URL(request.url);
    const recordId = url.searchParams.get('id');
    const body = await parseBody<{ gateway_response?: unknown }>(request);
    const { gateway_response } = body;

    if (!recordId) return error('id مطلوب');

    // Fetch the record
    const { data: record, error: recordErr } = await s.from('payment_records')
      .select('*')
      .eq('id', recordId)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (recordErr) throw recordErr;

    if (!record) return error('سجل الدفع غير موجود');
    const rec = record as { id: string; invoice_id: string; amount: number; status: string; payment_gateway_id: string; journal_entry_id?: string | null };
    // Idempotency: a paid record has already created its accounting event.
    if (rec.status === 'paid' || rec.journal_entry_id) {
      return success({ id: recordId, status: rec.status, alreadyProcessed: true });
    }
    // Manual records cannot be promoted through this endpoint. They require a
    // separately auditable voucher/receipt flow. Gateway status is fetched
    // server-side; no request body may assert "paid".
    if (!rec.payment_gateway_id || rec.payment_gateway_id.startsWith('manual_')) {
      return error('سجل الدفع اليدوي لا يمكن تأكيده هنا. أنشئ سند قبض معتمد.', 409);
    }

    let finalStatus: string;
    try {
      const gatewayStatus = await getPaymentStatus(rec.payment_gateway_id);
      finalStatus = mapPaymentStatus(gatewayStatus.status);
    } catch {
      return error('تعذر التحقق من حالة الدفع من البوابة', 503);
    }

    // The payment row, invoice, overpayment classification, journal and audit
    // are finalized under row locks in one transaction.
    const { data: finalized, error: finalizeErr } = await s.rpc('finalize_gateway_payment', {
      p_company_id: auth.companyId,
      p_payment_record_id: recordId,
      p_final_status: finalStatus,
      p_gateway_response: gateway_response ? JSON.stringify(gateway_response) : '',
      p_user_id: auth.userId,
    });
    if (finalizeErr) throw finalizeErr;
    return success(finalized);
  } catch (err) {
    return handleApiError(err);
  }
}
