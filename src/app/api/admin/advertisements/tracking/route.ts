import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';

const sb = () => getSupabase();

function sanitizeId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const cleaned = v.trim();
  if (!/^[0-9a-fA-F-]{8,}$/.test(cleaned)) return null;
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
    const [{ count: viewCount }, { count: clickCount }, { count: notifCount }] = await Promise.all([
      s.from('ad_views').select('*', { count: 'exact', head: true }).eq('advertisement_id', adId),
      s.from('ad_clicks').select('*', { count: 'exact', head: true }).eq('advertisement_id', adId),
      s.from('ad_notifications').select('*', { count: 'exact', head: true }).eq('advertisement_id', adId),
    ]);

    return success({
      ad,
      statistics: {
        totalViews: (ad as any).views || 0,
        totalClicks: (ad as any).clicks || 0,
        totalNotifications: (ad as any).notifications_sent || 0,
        viewEvents: viewCount || 0,
        clickEvents: clickCount || 0,
        notificationEvents: notifCount || 0,
      },
    });
  } catch (e: any) {
    return adminJsonError(e);
  }
}
