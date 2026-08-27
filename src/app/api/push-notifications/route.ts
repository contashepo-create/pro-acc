import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { pushQueueSchema, pushSubscriptionSchema } from '@/lib/communication-validation';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const { data, error: queryError } = await getSupabase().from('push_subscriptions')
      .select('id,endpoint,is_active,user_agent,created_at,updated_at').eq('user_id', auth.userId)
      .eq('company_id', auth.companyId).order('created_at', { ascending: false });
    if (queryError) throw queryError;
    return success({ subscriptions: data || [] });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const parsed = pushSubscriptionSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات اشتراك الإشعارات غير صالحة');
    const { endpoint, keys } = parsed.data.subscription;
    const { data, error: rpcError } = await getSupabase().rpc('upsert_push_subscription_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_endpoint: endpoint,
      p_p256dh: keys.p256dh, p_auth: keys.auth,
      p_user_agent: request.headers.get('user-agent')?.slice(0, 500) || '',
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireManagerOrAbove(request);
    const parsed = pushQueueSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الإشعار غير صالحة');
    const { data, error: rpcError } = await getSupabase().rpc('queue_push_notifications_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_payload: parsed.data,
    });
    if (rpcError) {
      const message = String(rpcError.message || 'تعذر جدولة الإشعارات');
      if (/المستهدف/.test(message)) return error(message, 404);
      if (/صلاحية/.test(message)) return error(message, 403);
      throw rpcError;
    }
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const endpoint = new URL(request.url).searchParams.get('endpoint') || '';
    if (!endpoint || endpoint.length > 4096) return error('endpoint غير صالح');
    try { if (new URL(endpoint).protocol !== 'https:') return error('endpoint غير صالح'); } catch { return error('endpoint غير صالح'); }
    const { data, error: rpcError } = await getSupabase().rpc('deactivate_push_subscription_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_endpoint: endpoint,
    });
    if (rpcError) {
      if (/غير موجود/.test(String(rpcError.message))) return error('الاشتراك غير موجود', 404);
      throw rpcError;
    }
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
