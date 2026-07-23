import { NextRequest } from 'next/server';
import { success, error, requireAdminAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/admin/app-settings
 * Get all global app settings
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const s = sb();

    const { data, error: queryErr } = await s.from('app_settings')
      .select('*')
      .order('category, key');

    if (queryErr) throw queryErr;

    // Group by category
    const grouped: Record<string, Record<string, string>> = {};
    (data || []).forEach((item: any) => {
      if (!grouped[item.category]) grouped[item.category] = {};
      grouped[item.category][item.key] = item.value || '';
    });

    return success(grouped);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/admin/app-settings
 * Update global app settings
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminAuth(request);
    const s = sb();
    const body = await request.json();

    // body is { key: value, key2: value2, ... }
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
