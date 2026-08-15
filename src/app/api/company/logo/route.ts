import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
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
    // تغيير شعار الشركة (هوية بصرية) — يقتصر على المدير فأعلى
    const auth = await requireManagerOrAbove(request);
    const body = await parseBody<{ logo_url?: string }>(request);
    const s = sb();

    if (!body.logo_url || typeof body.logo_url !== 'string' || body.logo_url.length > 2048) return error('logo_url is required');
    let logoUrl: string;
    try {
      const parsed = new URL(body.logo_url);
      if (!['https:', 'http:'].includes(parsed.protocol)) return error('رابط الشعار غير صالح');
      logoUrl = parsed.toString();
    } catch {
      return error('رابط الشعار غير صالح');
    }

    await s.from('companies').update({
      logo_url: logoUrl,
      updated_at: new Date().toISOString(),
    }).eq('id', auth.companyId);

    return success({ logo_url: logoUrl });
  } catch (err) {
    return handleApiError(err);
  }
}
