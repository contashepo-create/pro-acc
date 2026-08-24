import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';
import type { Row } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'receipts', 'read');
    const url = new URL(request.url);
    const asOf = url.searchParams.get('asOf');
    if (asOf && !isValidDate(asOf)) return error('تاريخ التقرير غير صالح');
    const { data, error: queryError } = await getSupabase().rpc('get_customer_advances', {
      p_company_id: auth.companyId,
      p_contact_id: null,
      p_as_of: asOf,
    });
    if (queryError) throw queryError;
    return success(((data ?? []) as Row[]).map((row: Row) => ({
      contact_id: row.contact_id,
      contact_name: row.contact_name,
      balance: Number(row.balance) || 0,
    })));
  } catch (err) {
    return handleApiError(err);
  }
}
