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

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await s.from('transaction_categories')
      .select('*, accounts(code, name)', { count: 'exact' })
      .eq('company_id', auth.companyId).order('name')
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const categories = (data || []).map((tc: any) => ({
      ...tc, account_code: tc.accounts?.code || null, account_name: tc.accounts?.name || null,
    }));

    return success({ categories, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { name, type, account_id } = data;
    if (!name || !type || !account_id) return error('name, type, account_id are required');
    const { data: result, error: insertError } = await s.from('transaction_categories')
      .insert({ company_id: auth.companyId, name, type, account_id, is_active: true })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
