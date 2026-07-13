import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const contactId = url.searchParams.get('contactId');

    let query = s.from('contacts')
      .select('*, accounts(code, name)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .in('type', ['client', 'both']);

    if (contactId) {
      query = query.eq('id', contactId);
    }

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('name')
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const clients = (data || []).map((c: any) => ({
      ...c,
      account_code: c.accounts?.code || null,
      account_name: c.accounts?.name || null,
      balance: 0,
    }));

    return success({ clients, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { name, phone, email, address, tax_number, commercial_registration, credit_limit } = data;

    if (!name) return error('name is required');

    const { data: result, error: insertError } = await s.from('contacts')
      .insert({
        company_id: auth.companyId,
        name,
        type: 'client',
        phone: phone || null,
        email: email || null,
        address: address || null,
        tax_number: tax_number || null,
        commercial_registration: commercial_registration || null,
        credit_limit: credit_limit || 0,
        is_active: true,
      })
      .select('*')
      .single();

    if (insertError) throw insertError;

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
