import { NextRequest } from 'next/server';
import { success, error, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const SAFE_KEY = /^[a-z][a-z0-9_]{1,63}$/;

/** GET /api/admin/app-settings — global key/value configuration. */
export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const { data, error: queryErr } = await sb().from('app_settings')
      .select('key, value, category');
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

/** PUT /api/admin/app-settings — atomically update values and audit the admin. */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminAuth(request);
    const body = await parseBody<Record<string, unknown>>(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error('بيانات الإعدادات غير صالحة');

    const entries = Object.entries(body);
    if (entries.length === 0) return success({ updated: 0 });
    if (entries.length > 50) return error('عدد الإعدادات كبير جداً');
    const updates: Record<string, string | number | boolean> = {};
    for (const [key, value] of entries) {
      if (!SAFE_KEY.test(key)) return error(`مفتاح إعداد غير صالح: ${key}`);
      if (!['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 5000) {
        return error(`قيمة إعداد غير صالحة: ${key}`);
      }
      updates[key] = value as string | number | boolean;
    }

    const { data, error: updateError } = await sb().rpc('admin_upsert_app_settings', {
      p_admin_id: auth.userId,
      p_updates: updates,
    });
    if (updateError) throw updateError;
    return success(data || { updated: 0 });
  } catch (err) {
    return handleApiError(err);
  }
}
