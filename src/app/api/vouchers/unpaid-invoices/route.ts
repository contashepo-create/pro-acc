import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contactId');

    if (!contactId) {
      return error('رقم العميل مطلوب');
    }

    const s = sb();

    const { data: invoices } = await s.from('invoices')
      .select('id, number, date, total, paid_amount, status')
      .eq('contact_id', contactId)
      .eq('company_id', auth.companyId)
      .in('status', ['unpaid', 'partial'])
      .order('date', { ascending: false });

    return success({
      invoices: (invoices || []).map((inv: any) => ({
        ...inv,
        total: parseFloat(inv.total),
        paid_amount: parseFloat(inv.paid_amount || '0'),
        remaining: parseFloat(inv.total) - parseFloat(inv.paid_amount || '0'),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
