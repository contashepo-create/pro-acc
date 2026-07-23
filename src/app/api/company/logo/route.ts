import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/company/logo
 * Returns company logo URL
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const { data: company } = await s.from('companies')
      .select('logo_url, name')
      .eq('id', auth.companyId).maybeSingle();
    return success({ logo_url: (company as any)?.logo_url || null, name: (company as any)?.name || '' });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/company/logo
 * Upload logo URL (stored as text in companies table)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const body = await request.json();
    const s = sb();

    if (!body.logo_url) return error('logo_url is required');

    await s.from('companies').update({
      logo_url: body.logo_url,
      updated_at: new Date().toISOString(),
    }).eq('id', auth.companyId);

    return success({ logo_url: body.logo_url });
  } catch (err) {
    return handleApiError(err);
  }
}
