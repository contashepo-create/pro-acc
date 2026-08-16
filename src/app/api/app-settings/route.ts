import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// Never expose arbitrary administrator-created configuration. Payment account
// details have a dedicated authenticated endpoint with its own field list.
const PUBLIC_SETTING_KEYS = [
  'app_name', 'app_name_en', 'app_version', 'developer_name',
  'support_email', 'support_phone', 'support_whatsapp', 'support_telegram',
  'support_website', 'footer_text',
] as const;

/** GET /api/app-settings — explicitly allow-listed display settings. */
export async function GET(request: NextRequest) {
  try {
    await requireApiAuth(request);
    const { data, error: queryErr } = await getSupabase().from('app_settings')
      .select('key, value')
      .in('key', [...PUBLIC_SETTING_KEYS]);
    if (queryErr) throw queryErr;

    const settings: Record<string, string> = {};
    (data || []).forEach((item: any) => {
      settings[item.key] = item.value || '';
    });
    return success(settings);
  } catch (err) {
    return handleApiError(err);
  }
}
