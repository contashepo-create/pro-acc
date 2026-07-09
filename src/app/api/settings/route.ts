import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { data, error: queryError } = await s.from('settings')
      .select('key, value').eq('company_id', auth.companyId);
    if (queryError) throw queryError;
    const map: Record<string, string> = {};
    for (const row of (data || [])) { map[row.key] = row.value; }
    return success({ settings: map });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { settings } = data;
    if (!settings) return error('settings are required');

    for (const [key, value] of Object.entries(settings)) {
      const { data: existing } = await s.from('settings')
        .select('id').eq('company_id', auth.companyId).eq('key', key).maybeSingle();
      if (existing) {
        await s.from('settings').update({ value: String(value) }).eq('id', existing.id);
      } else {
        await s.from('settings').insert({ company_id: auth.companyId, key, value: String(value) });
      }
    }
    return success({ updated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
