import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/vouchers/unpaid-invoices?contactId=...&kind=sale|purchase
 * الفواتير المفتوحة للطرف مع المتبقي القابل للتحصيل أو السداد.
 * البيع: المتبقي = (الأصل + الإشعارات المدينة المعتمدة − الدائنة المعتمدة) − المدفوع
 * الشراء: المتبقي = الإجمالي − المدفوع على فاتورة المشتريات.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') === 'purchase' ? 'purchase' : 'sale';
    const auth = await requireModulePermission(request, kind === 'purchase' ? 'disbursements' : 'receipts', 'read');
    const contactId = url.searchParams.get('contactId');
    if (!contactId || !UUID_RE.test(contactId)) return error('معرّف الطرف غير صالح');
    const s = getSupabase();
    const allowedTypes = kind === 'purchase'
      ? ['supplier', 'subcontractor', 'both']
      : ['client', 'both'];
    const { data: contact, error: contactError } = await s.from('contacts').select('id')
      .eq('id', contactId).eq('company_id', auth.companyId).in('type', allowedTypes)
      .eq('is_active', true).is('deleted_at', null).maybeSingle();
    if (contactError) throw contactError;
    if (!contact) return error(kind === 'purchase' ? 'المورد غير موجود' : 'العميل غير موجود', 404);

    if (kind === 'purchase') {
      const { data: invoices, error: invoiceError } = await s.from('purchase_invoices')
        .select('id, invoice_number, number, date, total, paid_amount, status')
        .eq('supplier_id', contactId).eq('company_id', auth.companyId)
        .in('status', ['unpaid', 'partial'])
        .order('date', { ascending: true });
      if (invoiceError) throw invoiceError;
      return success({
        invoices: (invoices || []).map((invoice: Record<string, unknown>) => {
          const total = Number(invoice.total) || 0;
          const paid = Number(invoice.paid_amount) || 0;
          return {
            ...invoice,
            number: invoice.invoice_number || invoice.number,
            total,
            net_total: total,
            paid_amount: paid,
            remaining: Math.max(0, total - paid),
          };
        }),
      });
    }

    const { data: invoices, error: invoiceError } = await s.from('invoices')
      .select('id, number, date, total, paid_amount, status')
      .eq('contact_id', contactId).eq('company_id', auth.companyId)
      .in('status', ['unpaid', 'partial']).is('deleted_at', null)
      .order('date', { ascending: true });
    if (invoiceError) throw invoiceError;

    const openIds = (invoices || []).map((invoice: Record<string, unknown>) => String(invoice.id));
    const notesByInvoice: Record<string, { debit: number; credit: number }> = {};
    if (openIds.length) {
      const { data: notes, error: notesError } = await s.from('credit_notes')
        .select('invoice_id, note_type, total')
        .eq('company_id', auth.companyId)
        .in('invoice_id', openIds)
        .eq('status', 'approved').is('deleted_at', null);
      if (notesError) throw notesError;
      for (const note of (notes || []) as Array<Record<string, unknown>>) {
        const key = String(note.invoice_id);
        const bucket = notesByInvoice[key] || { debit: 0, credit: 0 };
        if (note.note_type === 'debit') bucket.debit += Number(note.total) || 0;
        else bucket.credit += Number(note.total) || 0;
        notesByInvoice[key] = bucket;
      }
    }

    return success({
      invoices: (invoices || []).map((invoice: Record<string, unknown>) => {
        const total = Number(invoice.total) || 0;
        const paid = Number(invoice.paid_amount) || 0;
        const notes = notesByInvoice[String(invoice.id)] || { debit: 0, credit: 0 };
        const netTotal = total + notes.debit - notes.credit;
        return {
          ...invoice,
          total,
          net_total: netTotal,
          notes_debit: notes.debit,
          notes_credit: notes.credit,
          paid_amount: paid,
          remaining: Math.max(0, netTotal - paid),
        };
      }),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
