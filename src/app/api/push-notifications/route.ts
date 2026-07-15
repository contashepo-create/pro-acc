import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/push-notifications — Get subscriptions for current user
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    const { data: subs } = await s.from('push_subscriptions')
      .select('*')
      .eq('user_id', auth.userId);

    return success({ subscriptions: subs || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/push-notifications — Subscribe for push notifications
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.subscription) {
      return error('subscription مطلوب');
    }

    const { endpoint, keys } = body.subscription;

    // Check if already subscribed
    const { data: existing } = await s.from('push_subscriptions')
      .select('id')
      .eq('user_id', auth.userId)
      .eq('endpoint', endpoint)
      .maybeSingle();

    if (existing) {
      return success({ message: 'مُسجّل مسبقاً', id: (existing as { id: string }).id });
    }

    const subId = generateId();
    const { data, error: insertErr } = await s.from('push_subscriptions')
      .insert({
        id: subId,
        user_id: auth.userId,
        company_id: auth.companyId,
        endpoint,
        p256dh_key: keys?.p256dh || null,
        auth_key: keys?.auth || null,
        user_agent: request.headers.get('user-agent') || null,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/push-notifications — Send push notification to users
 * Can send to specific user, role, or all users in company
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    const { title, message, url, target_user_id, target_role, tag, actions } = body;

    if (!title || !message) {
      return error('العنوان والرسالة مطلوبان');
    }

    // Get target subscriptions
    let query = s.from('push_subscriptions')
      .select('*')
      .eq('company_id', auth.companyId)
      .eq('is_active', true);

    if (target_user_id) {
      query = query.eq('user_id', target_user_id);
    }

    const { data: subscriptions, error: subErr } = await query;
    if (subErr) throw subErr;

    // Send push notifications using Web Push protocol
    // Note: In production, use a proper Web Push library like 'web-push'
    // This is a simplified version that stores the notification in DB
    const notifications = [];
    const subs = subscriptions || [];

    for (const sub of subs) {
      const subObj = sub as any;

      // If target_role filter
      if (target_role) {
        const { data: user } = await s.from('users')
          .select('role')
          .eq('id', subObj.user_id)
          .maybeSingle();
        if (!user || (user as any).role !== target_role) continue;
      }

      const notifId = generateId();
      try {
        await s.from('push_notification_log').insert({
          id: notifId,
          company_id: auth.companyId,
          subscription_id: subObj.id,
          user_id: subObj.user_id,
          title,
          body: message,
          url: url || '/dashboard',
          tag: tag || null,
          actions: actions ? JSON.stringify(actions) : null,
          status: 'queued',
          sent_at: new Date().toISOString(),
        });
        notifications.push({ id: notifId, userId: subObj.user_id, status: 'queued' });
      } catch (logErr) {
        notifications.push({ userId: subObj.user_id, status: 'failed', error: (logErr as Error).message });
      }
    }

    // Also store in regular notifications table for in-app display
    if (target_user_id) {
      await s.from('notifications').insert({
        id: generateId(),
        company_id: auth.companyId,
        user_id: target_user_id,
        type: 'push',
        title,
        message,
        entity_type: 'push_notification',
        entity_id: notifications[0]?.id || null,
        created_at: new Date().toISOString(),
      });
    } else if (!target_role) {
      // Send to all active users
      const { data: allUsers } = await s.from('users')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('is_active', true);

      for (const user of (allUsers || [])) {
        const u = user as { id: string };
        await s.from('notifications').insert({
          id: generateId(),
          company_id: auth.companyId,
          user_id: u.id,
          type: 'push',
          title,
          message,
          entity_type: 'push_notification',
          created_at: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    return success({
      sent: notifications.length,
      notifications,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/push-notifications — Unsubscribe
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const endpoint = url.searchParams.get('endpoint');

    if (endpoint) {
      await s.from('push_subscriptions')
        .delete()
        .eq('user_id', auth.userId)
        .eq('endpoint', endpoint);
    }

    return success({ unsubscribed: true });
  } catch (err) {
    return handleApiError(err);
  }
}
