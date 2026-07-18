import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody } from '@/lib/api-helpers';
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { data, error: err } = await s.from('pos_terminals').select('*').eq('company_id', auth.companyId).order('code');
    if (err) throw err;
    return success({ terminals: data || [] });
  } catch (e) { return handleApiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const body = await parseBody(req);
    const { code, name } = body;
    if (!code || !name) return error('code, name required');
    const { data, error: err } = await s.from('pos_terminals').insert({ company_id: auth.companyId, code, name }).select().single();
    if (err) throw err;
    return success(data, 201);
  } catch (e) { return handleApiError(e); }
}
