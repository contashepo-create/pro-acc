import { NextRequest } from 'next/server';
import { success, serverError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

/**
 * Public advertisements endpoint (unauthenticated).
 * Only returns active, non-expired ads for a requested display_mode.
 * Write operations (POST/PATCH/DELETE) are NOT exposed here.
 */
export async function GET(req: NextRequest) {
  try {
    const displayMode = req.nextUrl.searchParams.get('display_mode') || 'top_bar';
    // Whitelist display modes to prevent arbitrary filter abuse
    const allowedModes = new Set(['top_bar', 'banner', 'popup', 'modal', 'inline']);
    const mode = allowedModes.has(displayMode) ? displayMode : 'top_bar';

    const s = getSupabase();
    const { data, error } = await s
      .from('advertisements')
      .select('id, title, body, type, display_mode, priority, link_url, link_text, expires_at, starts_at, is_active')
      .eq('is_active', true)
      .eq('display_mode', mode)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      if (error.code === '42P01') return success([]);
      throw error;
    }

    const now = new Date();
    const filtered = (data || []).filter((ad: any) => {
      if (ad.expires_at && new Date(ad.expires_at) < now) return false;
      if (ad.starts_at && new Date(ad.starts_at) > now) return false;
      return true;
    });

    return success(filtered);
  } catch (err) {
    return serverError(err);
  }
}
