import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();

    const { data: warehouses } = await s.from('warehouses')
      .select('*')
      .eq('company_id', auth.companyId)
      .order('name');

    return success({ warehouses: warehouses || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { name, location } = data;

    if (!name) return error('name is required');

    const s = sb();
    const { data: result, error: insertError } = await s.from('warehouses')
      .insert({
        company_id: auth.companyId,
        name,
        location: location || null,
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
