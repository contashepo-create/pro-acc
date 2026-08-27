import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

function sanitizeId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const cleaned = v.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)) return null;
  return cleaned;
}

/**
 * GET (admin-only): return view/click/notification stats for one ad.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const adId = sanitizeId(req.nextUrl.searchParams.get('ad_id'));
    if (!adId) return error('ad_id غير صالح', 400);

    const s = sb();
    const { data: ad, error: adError } = await s.from('advertisements')
      .select('id, title, views, clicks, notifications_sent, display_mode, type, is_active')
      .eq('id', adId)
      .maybeSingle();

    if (adError) throw adError;
    if (!ad) return error('الإعلان غير موجود', 404);

    // Stats only — do NOT leak IPs or PII to the admin dashboard beyond counts
    const [viewsResult, clicksResult, notificationsResult] = await Promise.all([
      s.from('ad_views').select('id', { count: 'exact', head: true }).eq('advertisement_id', adId),
      s.from('ad_clicks').select('id', { count: 'exact', head: true }).eq('advertisement_id', adId),
      s.from('ad_notifications').select('id', { count: 'exact', head: true }).eq('advertisement_id', adId),
    ]);
    if (viewsResult.error) throw viewsResult.error;
    if (clicksResult.error) throw clicksResult.error;
    if (notificationsResult.error) throw notificationsResult.error;
    const viewCount = viewsResult.count;
    const clickCount = clicksResult.count;
    const notifCount = notificationsResult.count;

    return success({
      ad,
      statistics: {
        totalViews: (ad as Row).views || 0,
        totalClicks: (ad as Row).clicks || 0,
        totalNotifications: (ad as Row).notifications_sent || 0,
        viewEvents: viewCount || 0,
        clickEvents: clickCount || 0,
        notificationEvents: notifCount || 0,
      },
    });
  } catch (e: unknown) {
    return adminJsonError(e);
  }
}
