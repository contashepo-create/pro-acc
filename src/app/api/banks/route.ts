import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const { page, pageSize } = getPaginationParams(request.url);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await s.from('banks_safes')
      .select('*, accounts(code, name)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .order('type')
      .order('name')
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const banks = (data || []).map((bs: any) => ({
      ...bs,
      account_code: bs.accounts?.code || null,
      account_name: bs.accounts?.name || null,
    }));

    return success({ banks, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const data = await parseBody(request);
    const { name, type, account_number, account_id, opening_balance } = data;

    if (!name || !type) return error('name, type are required');

    const { data: result, error: insertError } = await s.from('banks_safes')
      .insert({
        company_id: auth.companyId,
        name,
        type,
        account_number: account_number || null,
        account_id: account_id || null,
        opening_balance: opening_balance || 0,
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
