import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/app-settings
 * Public app settings (read-only, visible to all authenticated users)
 * Returns flat key-value map
 */
export async function GET(request: NextRequest) {
  try {
    await requireApiAuth(request);
    const s = sb();

    const { data, error: queryErr } = await s.from('app_settings')
      .select('key, value')
      .eq('is_public', true);

    if (queryErr) throw queryErr;

    // Return flat key-value map
    const settings: Record<string, string> = {};
    (data || []).forEach((item: any) => {
      settings[item.key] = item.value || '';
    });

    return success(settings);
  } catch (err) {
    return handleApiError(err);
  }
}
