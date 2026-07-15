import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { initPayment, getPaymentStatus, refundPayment, mapPaymentStatus } from '@/lib/payments/moyasar';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/payments — List all payment records for the company
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
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
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();
    const { invoice_id, customer_name, customer_email, return_url } = body as {
      invoice_id?: string;
      customer_name?: string;
      customer_email?: string;
      return_url?: string;
    };

    if (!invoice_id) return error('invoice_id مطلوب');

    // Fetch invoice
    const { data: invoice } = await s.from('invoices')
      .select('id, number, total, status, contact_id, contacts(name, email)')
      .eq('id', invoice_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!invoice) return error('الفاتورة غير موجودة');
    const inv = invoice as { id: string; number: number; total: number; status: string; contact_id: string; contacts: { name: string; email: string } | null };

    if (inv.status === 'paid') return error('الفاتورة مدفوعة بالفعل');

    const name = customer_name || inv.contacts?.name || 'عميل';
    const email = customer_email || inv.contacts?.email || '';

    try {
      const host = request.headers.get('host') || 'localhost:3000';
      const protocol = request.headers.get('x-forwarded-proto') || 'https';
      const callbackUrl = return_url || `${protocol}://${host}/invoices?payment=callback`;

      const { paymentId, paymentUrl } = await initPayment({
        amount: parseFloat(String(inv.total)),
        description: `دفعة فاتورة رقم ${inv.number}`,
        callbackUrl,
        invoiceId: inv.id,
        customerName: name,
        customerEmail: email,
      });

      // Store payment record
      const recordId = generateId();
      await s.from('payment_records').insert({
        id: recordId,
        company_id: auth.companyId,
        invoice_id: inv.id,
        payment_gateway_id: paymentId,
        amount: parseFloat(String(inv.total)),
        currency: 'SAR',
        status: 'pending',
        customer_name: name,
        customer_email: email,
        payment_url: paymentUrl,
        created_by: auth.userId,
      });

      return success({
        paymentId,
        paymentUrl,
        recordId,
        amount: inv.total,
        invoiceNumber: inv.number,
      }, 201);
    } catch (moyasarErr) {
      // If Moyasar is not configured, create a manual payment record
      console.warn('Moyasar not available, creating manual payment link:', moyasarErr);

      const recordId = generateId();
      await s.from('payment_records').insert({
        id: recordId,
        company_id: auth.companyId,
        invoice_id: inv.id,
        payment_gateway_id: `manual_${Date.now()}`,
        amount: parseFloat(String(inv.total)),
        currency: 'SAR',
        status: 'pending',
        customer_name: name,
        customer_email: email,
        payment_url: null,
        notes: 'Manual payment — Moyasar not configured',
        created_by: auth.userId,
      });

      return success({
        paymentId: `manual_${Date.now()}`,
        paymentUrl: null,
        recordId,
        amount: inv.total,
        invoiceNumber: inv.number,
        message: 'تم إنشاء سجل الدفع. بوابة الدفع غير مهيأة — أضف MOYASAR_SECRET_KEY لتفعيل الدفع الإلكتروني',
      }, 201);
    }
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/payments?id=... — Update payment status (used by webhook)
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const recordId = url.searchParams.get('id');
    const body = await request.json();
    const { status, gateway_response } = body as { status?: string; gateway_response?: unknown };

    if (!recordId) return error('id مطلوب');

    // Fetch the record
    const { data: record } = await s.from('payment_records')
      .select('*')
      .eq('id', recordId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!record) return error('سجل الدفع غير موجود');
    const rec = record as { id: string; invoice_id: string; amount: number; status: string; payment_gateway_id: string };

    // If checking status from gateway, fetch latest
    let finalStatus = status || rec.status;
    if (!status && rec.payment_gateway_id && !rec.payment_gateway_id.startsWith('manual_')) {
      try {
        const gatewayStatus = await getPaymentStatus(rec.payment_gateway_id);
        finalStatus = mapPaymentStatus(gatewayStatus.status);
      } catch {
        // keep current status
      }
    }

    // Update the record
    await s.from('payment_records').update({
      status: finalStatus,
      gateway_response: gateway_response ? JSON.stringify(gateway_response) : null,
      updated_at: new Date().toISOString(),
    }).eq('id', recordId);

    // If paid, update invoice status
    if (finalStatus === 'paid') {
      await s.from('invoices').update({ status: 'paid' }).eq('id', rec.invoice_id);

      // Auto-create cash receipt journal entry
      try {
        const { getNextJournalNumber } = await import('@/lib/numbering');
        const today = new Date().toISOString().split('T')[0];
        const jeNumber = await getNextJournalNumber(auth.companyId, today);
        const jeId = generateId();

        // Find AR account (1130) and cash/bank account
        const { data: arAcc } = await s.from('accounts')
          .select('id').eq('company_id', auth.companyId).eq('code', '1130').maybeSingle();
        const { data: cashAcc } = await s.from('accounts')
          .select('id').eq('company_id', auth.companyId).eq('code', '1100').maybeSingle();

        if (arAcc && cashAcc) {
          const ar = arAcc as { id: string };
          const cash = cashAcc as { id: string };

          await s.from('journal_entries').insert({
            id: jeId, company_id: auth.companyId, number: jeNumber,
            date: today, type: 'general',
            description: `سداد إلكتروني — فاتورة`, created_by: auth.userId,
          });
          await s.from('journal_lines').insert([
            { journal_entry_id: jeId, account_id: cash.id, debit: rec.amount, credit: 0, description: 'سداد إلكتروني' },
            { journal_entry_id: jeId, account_id: ar.id, debit: 0, credit: rec.amount, description: 'سداد فاتورة' },
          ]);

          await s.from('payment_records').update({ journal_entry_id: jeId }).eq('id', recordId);
        }
      } catch (journalErr) {
        console.warn('Failed to create auto journal entry for payment:', journalErr);
      }
    }

    return success({ id: recordId, status: finalStatus });
  } catch (err) {
    return handleApiError(err);
  }
}
