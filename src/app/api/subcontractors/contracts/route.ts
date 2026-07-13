import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await s.from('subcontractor_contracts')
      .select('*, contacts(name)', { count: 'exact' }).eq('company_id', auth.companyId)
      .order('start_date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const contracts = (data || []).map((sc: any) => ({ ...sc, subcontractor_name: sc.contacts?.name || null }));
    return success({ contracts, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { subcontractor_id, contract_number, description, contract_value, start_date, end_date, retention_rate } = data;
    if (!subcontractor_id || !contract_number || !contract_value || !start_date)
      return error('subcontractor_id, contract_number, contract_value, start_date are required');

    const { data: result, error: insertError } = await s.from('subcontractor_contracts')
      .insert({ company_id: auth.companyId, subcontractor_id, contract_number, description: description || null, contract_value, start_date, end_date: end_date || null, retention_rate: retention_rate || 0, status: 'active' })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) { return handleApiError(err); }
}
