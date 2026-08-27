import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';
import type { Row } from '@/lib/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'receipts', 'read');
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contactId');
    const asOf = url.searchParams.get('asOf');
    if (!contactId || !UUID_RE.test(contactId)) return error('معرّف العميل غير صالح');
    if (asOf && !isValidDate(asOf)) return error('تاريخ التقرير غير صالح');
    const s = getSupabase();
    const { data: contact, error: contactError } = await s.from('contacts').select('id')
      .eq('id', contactId).eq('company_id', auth.companyId).in('type', ['client', 'both']).maybeSingle();
    if (contactError) throw contactError;
    if (!contact) return error('العميل غير موجود', 404);

    const { data, error: balanceError } = await s.rpc('get_customer_advances', {
      p_company_id: auth.companyId,
      p_contact_id: contactId,
      p_as_of: asOf,
    });
    if (balanceError) throw balanceError;
    const row = ((data ?? []) as Row[])[0];
    return success({ contact_id: contactId, balance: Number(row?.balance) || 0 });
  } catch (err) {
    return handleApiError(err);
  }
}
