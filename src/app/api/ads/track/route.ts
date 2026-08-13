import { NextRequest } from 'next/server';
import { success, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

/**
 * Authenticated ad-view/click tracking for logged-in users.
 * Requires a valid user session to prevent anonymous inflation.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const body = await request.json().catch(() => ({})) as { ad_id?: string; event?: 'view' | 'click' };
    const adId = typeof body.ad_id === 'string' ? body.ad_id.trim() : '';
    const event = body.event === 'click' ? 'click' : 'view';
    if (!/^[0-9a-fA-F-]{8,}$/.test(adId)) return success({ ok: false });

    const s = getSupabase();
    const { data: ad } = await s.from('advertisements')
      .select('id, is_active, views, clicks')
      .eq('id', adId).maybeSingle();
    if (!ad || !(ad as any).is_active) return success({ ok: false });

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
    const ua = request.headers.get('user-agent') || null;
    const now = new Date().toISOString();

    if (event === 'view') {
      const { data: existing } = await s.from('ad_views')
        .select('id').eq('advertisement_id', adId).eq('company_id', auth.companyId)
        .maybeSingle();
      if (existing) return success({ already_viewed: true });
      await s.from('ad_views').insert({
        advertisement_id: adId, company_id: auth.companyId, user_id: auth.userId,
        ip_address: ip, user_agent: ua, viewed_at: now,
      });
      await s.from('advertisements').update({ views: ((ad as any).views || 0) + 1 }).eq('id', adId);
    } else {
      const { data: existing } = await s.from('ad_clicks')
        .select('id').eq('advertisement_id', adId).eq('company_id', auth.companyId)
        .maybeSingle();
      if (existing) return success({ already_clicked: true });
      await s.from('ad_clicks').insert({
        advertisement_id: adId, company_id: auth.companyId, user_id: auth.userId,
        ip_address: ip, user_agent: ua, clicked_at: now,
      });
      await s.from('advertisements').update({ clicks: ((ad as any).clicks || 0) + 1 }).eq('id', adId);
    }
    return success({ ok: true });
  } catch {
    return success({ ok: false });
  }
}
