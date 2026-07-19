import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { data, error: queryError } = await s.from('currencies')
      .select('*').eq('company_id', auth.companyId).order('is_base', { ascending: false }).order('code');
    if (queryError) throw queryError;
    return success(data || []);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { code, name, rate, isBase } = await parseBody(req);
    if (!code || !name) return error('code and name are required');
    const { data: result, error: insertError } = await s.from('currencies')
      .insert({ company_id: auth.companyId, code, name, rate: rate ?? 1, is_base: isBase ?? false })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
