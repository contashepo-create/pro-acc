import { NextRequest } from 'next/server';
import { success, error, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/admin/app-settings
 * Returns flat key-value map: { app_name: "برو أكاونت", support_email: "...", ... }
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const s = sb();

    const { data, error: queryErr } = await s.from('app_settings')
      .select('key, value, category');

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

/**
 * PUT /api/admin/app-settings
 * Body: { key1: "value1", key2: "value2", ... }
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminAuth(request);
    const s = sb();
    const body = await parseBody(request);

    const updates = Object.entries(body).map(([key, value]) => ({
      key,
      value: String(value),
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    }));

    if (updates.length > 0) {
      const { error: upsertErr } = await s.from('app_settings')
        .upsert(updates, { onConflict: 'key' });
      if (upsertErr) throw upsertErr;
    }

    return success({ updated: updates.length });
  } catch (err) {
    return handleApiError(err);
  }
}
