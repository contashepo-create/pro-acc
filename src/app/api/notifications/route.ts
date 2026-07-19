import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');
    const { data, error: queryError } = await s.from('notifications')
      .select('*').eq('company_id', auth.companyId).order('created_at', { ascending: false }).limit(limit);
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
    const { type, title, message, link } = await parseBody(req);
    if (!type || !title || !message) return error('type, title, message are required');
    const { data: result, error: insertError } = await s.from('notifications')
      .insert({ company_id: auth.companyId, user_id: auth.userId, type, title, message, link: link || null })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
