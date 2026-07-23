import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/app-settings
 * Public app settings (read-only, visible to all authenticated users)
 * Returns full metadata for dynamic rendering
 */
export async function GET(request: NextRequest) {
  try {
    await requireApiAuth(request);
    const s = sb();

    const { data, error: queryErr } = await s.from('app_settings')
      .select('key, value, label, icon, field_type, category, sort_order')
      .eq('is_public', true)
      .order('category, sort_order, key');

    if (queryErr) throw queryErr;

    // Group by category as arrays
    const grouped: Record<string, any[]> = {};
    (data || []).forEach((item: any) => {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push({
        key: item.key,
        label: item.label || item.key,
        value: item.value || '',
        icon: item.icon || 'Info',
        field_type: item.field_type || 'text',
        sort_order: item.sort_order || 0,
      });
    });

    return success(grouped);
  } catch (err) {
    return handleApiError(err);
  }
}
