import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

/** Authenticated, exactly-once view/click tracking per company and ad. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const body = await parseBody<{ ad_id?: string; event?: 'view' | 'click' }>(request);
    const adId = typeof body.ad_id === 'string' ? body.ad_id.trim() : '';
    if (!/^[0-9a-fA-F-]{8,}$/.test(adId) || !['view', 'click'].includes(body.event || '')) {
      return success({ ok: false });
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip') || null;
    const userAgent = request.headers.get('user-agent') || null;
    const { data, error } = await getSupabase().rpc('record_ad_event', {
      p_ad_id: adId,
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_event: body.event,
      p_ip: ip,
      p_user_agent: userAgent,
    });
    if (error) throw error;
    return success({ ok: true, recorded: data === true, already_recorded: data !== true });
  } catch (err) {
    return handleApiError(err);
  }
}
