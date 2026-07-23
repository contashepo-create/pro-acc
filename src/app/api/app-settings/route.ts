import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/app-settings
 * Public app settings (read-only, visible to all authenticated users)
 */
export async function GET(request: NextRequest) {
  try {
    await requireApiAuth(request);
    const s = sb();

    const { data, error: queryErr } = await s.from('app_settings')
      .select('key, value, category')
      .eq('is_public', true)
      .order('category, key');

    if (queryErr) throw queryErr;

    const settings: Record<string, any> = {};
    (data || []).forEach((item: any) => {
      settings[item.key] = item.value || '';
    });

    return success(settings);
  } catch (err) {
    return handleApiError(err);
  }
}
