import { NextRequest } from 'next/server';
import { error, handleApiError, success } from '@/lib/api-helpers';
import { verifyPortalToken } from '@/lib/portal-auth';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = verifyPortalToken(request.headers.get('x-portal-token') || '');
    if (!auth) return error('رابط الدخول غير صالح أو انتهت صلاحيته', 401);

    const s = sb();
    const { data: contact, error: contactError } = await s.from('contacts')
      .select('id')
      .eq('id', auth.contactId)
      .eq('company_id', auth.companyId)
      .eq('email', auth.email)
      .maybeSingle();
    if (contactError) throw contactError;
    if (!contact) return error('رابط الدخول غير صالح أو انتهت صلاحيته', 401);

    const { id } = await params;
    const { data: invoice, error: invoiceError } = await s.from('invoices')
      .select('id, number, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes, zatca_qr, contact_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .eq('contact_id', auth.contactId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return error('الفاتورة غير موجودة', 404);

    const { data: items, error: itemsError } = await s.from('invoice_items')
      .select('id, description, quantity, unit_price, total')
      .eq('invoice_id', id)
      .eq('company_id', auth.companyId);
    if (itemsError) throw itemsError;

    const { data: company, error: companyError } = await s.from('companies')
      .select('name, tax_number, address, phone, logo_url')
      .eq('id', auth.companyId)
      .maybeSingle();
    if (companyError) throw companyError;

    return success({ ...invoice, items: items || [], company: company || {} });
  } catch (err) {
    return handleApiError(err);
  }
}
