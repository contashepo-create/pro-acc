import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
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
    const auth = await requireApiAuth(request);
    const s = sb();
    const data = await parseBody(request);
    const { name, start_date, end_date } = data;
    if (!name || !start_date || !end_date) return error('name, start_date, end_date are required');

    const { data: overlap } = await s.from('fiscal_years')
      .select('id').eq('company_id', auth.companyId)
      .lte('start_date', end_date).gte('end_date', start_date).limit(1);
    if (overlap && overlap.length > 0) return error('الفترة المالية تتداخل مع فترة موجودة');

    const { data: result, error: insertError } = await s.from('fiscal_years')
      .insert({ company_id: auth.companyId, name, start_date, end_date, status: 'open' })
      .select('*').single();
    if (insertError) throw insertError;

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
