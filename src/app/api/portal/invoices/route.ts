import { NextRequest } from 'next/server';
import { error, handleApiError, success } from '@/lib/api-helpers';
import { verifyPortalToken } from '@/lib/portal-auth';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/** GET /api/portal/invoices — invoices for a verified portal magic link. */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('x-portal-token') || '';
    const auth = verifyPortalToken(token);
    if (!auth) return error('رابط الدخول غير صالح أو انتهت صلاحيته', 401);

    const s = sb();
    // Re-check the contact so deleting/reassigning it revokes an outstanding
    // link immediately rather than waiting for its expiry.
    const { data: contact, error: contactError } = await s.from('contacts')
      .select('id, email, companies!inner(is_active)')
      .eq('id', auth.contactId)
      .eq('company_id', auth.companyId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .eq('companies.is_active', true)
      .maybeSingle();
    if (contactError) throw contactError;
    if (!contact || String(contact.email || '').toLowerCase() !== auth.email) {
      return error('رابط الدخول غير صالح أو انتهت صلاحيته', 401);
    }

    const { data: invoices, error: invoiceError } = await s.from('invoices')
      .select('id, number, date, due_date, subtotal, vat_amount, total, status, zatca_qr, notes')
      .eq('company_id', auth.companyId)
      .eq('contact_id', auth.contactId)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .order('date', { ascending: false });
    if (invoiceError) throw invoiceError;

    return success({ invoices: invoices || [] });
  } catch (err) {
    return handleApiError(err);
  }
}
