import { NextRequest } from 'next/server';
import { success, error, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/admin/app-settings
 * Get all app settings grouped by category with full metadata
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const s = sb();

    const { data, error: queryErr } = await s.from('app_settings')
      .select('*')
      .order('category, sort_order, key');

    if (queryErr) throw queryErr;

    // Group by category as array of items (preserve order and metadata)
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
        is_custom: item.is_custom || false,
      });
    });

    return success(grouped);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/admin/app-settings
 * Update existing settings values
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

/**
 * POST /api/admin/app-settings
 * Add a new custom field
 * Body: { key, label, value, icon, field_type, category, sort_order }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminAuth(request);
    const s = sb();
    const body = await parseBody(request);

    const { key, label, value, icon, field_type, category, sort_order } = body;

    if (!key || !label) {
      return error('key and label are required');
    }

    // Check if key already exists
    const { data: existing } = await s.from('app_settings')
      .select('key')
      .eq('key', key)
      .maybeSingle();

    if (existing) {
      return error('مفتالحقل موجود مسبقاً', 400);
    }

    const { data: newField, error: insertErr } = await s.from('app_settings')
      .insert({
        key,
        label,
        value: value || '',
        icon: icon || 'Info',
        field_type: field_type || 'text',
        category: category || 'custom',
        sort_order: sort_order || 99,
        is_custom: true,
        is_public: true,
        updated_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    return success(newField, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
