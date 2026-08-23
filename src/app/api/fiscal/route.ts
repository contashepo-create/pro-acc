import {NextRequest} from 'next/server';
import {success, error, parseBody, requireModulePermission, handleApiError} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'read');
    const s = sb();
    const { data, error: queryError } = await s.from('fiscal_years')
      .select('*').eq('company_id', auth.companyId).order('start_date', { ascending: false });
    if (queryError) throw queryError;
    return success({ fiscalYears: data || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'create');
    const data = await parseBody<Record<string, unknown>>(request);
    const { name, start_date, end_date } = data;
    if (!name || !start_date || !end_date) return error('name, start_date, end_date are required');
    const { data: result, error: rpcError } = await sb().rpc('create_fiscal_year_atomic', {
      p_company_id: auth.companyId,
      p_name: String(name),
      p_start_date: String(start_date),
      p_end_date: String(end_date),
      p_user_id: auth.userId,
    });
    if (rpcError) {
      const message = String(rpcError.message || 'تعذر إنشاء السنة المالية');
      if (/تتداخل|أكثر من سنة/.test(message)) return error(message, 409);
      throw rpcError;
    }
    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
