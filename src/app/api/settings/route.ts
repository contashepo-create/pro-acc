import { NextRequest } from 'next/server';
import { success, error, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/settings
 * Get company settings with key validation
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // Only fetch whitelisted keys
    const { data: allowedKeys } = await s.from('allowed_settings_keys')
      .select('key_name')
      .eq('is_sensitive', false);

    const validKeys = (allowedKeys || []).map((k: any) => k.key_name);

    if (validKeys.length === 0) {
      return success({});
    }

    const { data: settings } = await s.from('settings')
      .select('key, value')
      .eq('company_id', auth.companyId)
      .in('key', validKeys);

    const settingsMap: Record<string, any> = {};
    (settings || []).forEach((item: any) => {
      try {
        settingsMap[item.key] = JSON.parse(item.value);
      } catch {
        settingsMap[item.key] = item.value;
      }
    });

    return success(settingsMap);
  } catch (err) {
    console.error('Failed to fetch settings:', err);
    return error('فشل تحميل الإعدادات', 500);
  }
}

/**
 * PUT /api/settings
 * Update company settings with validation
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const body = await request.json();
    const s = sb();

    // Validate that we're only updating whitelisted keys
    const { data: allowedKeys } = await s.from('allowed_settings_keys')
      .select('key_name');

    const validKeys = new Set((allowedKeys || []).map((k: any) => k.key_name));

    // Check for invalid keys
    const invalidKeys = Object.keys(body.settings || {}).filter(
      key => !validKeys.has(key)
    );

    if (invalidKeys.length > 0) {
      return error(
        `مفاتيح إعدادات غير صالحة: ${invalidKeys.join(', ')}`,
        400
      );
    }

    // Update each setting
    const updates = Object.entries(body.settings || {}).map(([key, value]) => ({
      company_id: auth.companyId,
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      updated_at: new Date().toISOString(),
    }));

    if (updates.length > 0) {
      await s.from('settings')
        .upsert(updates, { onConflict: 'company_id,key' });
    }

    return success({ updated: true });
  } catch (err) {
    console.error('Failed to update settings:', err);
    return error('فشل تحديث الإعدادات', 500);
  }
}