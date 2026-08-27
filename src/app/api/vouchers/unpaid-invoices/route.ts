import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/vouchers/unpaid-invoices?contactId=...
 * الفواتير المفتوحة للعميل مع المتبقي القابل للتحصيل.
 * المتبقي = (الأصل + الإشعارات المدينة المعتمدة − الدائنة المعتمدة) − المدفوع
 * وهو نفس الحد المفروض في قاعدة البيانات عند تخصيص سند القبض.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'receipts', 'read');
    const contactId = new URL(request.url).searchParams.get('contactId');
    if (!contactId || !UUID_RE.test(contactId)) return error('معرّف العميل غير صالح');
    const s = getSupabase();
    const { data: contact, error: contactError } = await s.from('contacts').select('id')
      .eq('id', contactId).eq('company_id', auth.companyId).in('type', ['client', 'both'])
      .eq('is_active', true).is('deleted_at', null).maybeSingle();
    if (contactError) throw contactError;
    if (!contact) return error('العميل غير موجود', 404);

    const { data: invoices, error: invoiceError } = await s.from('invoices')
      .select('id, number, date, total, paid_amount, status')
      .eq('contact_id', contactId).eq('company_id', auth.companyId)
      .in('status', ['unpaid', 'partial']).is('deleted_at', null)
      .order('date', { ascending: false });
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
