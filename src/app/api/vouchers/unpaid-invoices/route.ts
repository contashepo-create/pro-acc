import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    return success({
      invoices: (invoices || []).map((invoice: Record<string, unknown>) => {
        const total = Number(invoice.total) || 0;
        const paid = Number(invoice.paid_amount) || 0;
        return { ...invoice, total, paid_amount: paid, remaining: Math.max(0, total - paid) };
      }),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
