import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

const sb = () => getSupabase();

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
  return payload;
}

// Get ad tracking data (views, clicks, notifications)
export async function GET(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    const adId = req.nextUrl.searchParams.get('ad_id');

    if (!adId) return error('ad_id مطلوب');

    const s = sb();

    // Get ad statistics
    const { data: ad, error: adError } = await s.from('advertisements')
      .select('id, title, views, clicks, notifications_sent, display_mode, type, is_active')
      .eq('id', adId)
      .single();

    if (adError) throw adError;

    // Get views by company
    const { data: viewsData } = await s
      .from('ad_views')
      .select(`
        company_id,
        companies!inner(id, name, email),
        users!inner(id, name, email),
        viewed_at,
        ip_address
      `)
      .eq('advertisement_id', adId)
      .order('viewed_at', { ascending: false })
      .limit(100);

    // Get clicks by company
    const { data: clicksData } = await s
      .from('ad_clicks')
      .select(`
        company_id,
        companies!inner(id, name, email),
        users!inner(id, name, email),
        clicked_at,
        ip_address
      `)
      .eq('advertisement_id', adId)
      .order('clicked_at', { ascending: false })
      .limit(100);

    // Get notifications sent
    const { data: notificationsData } = await s
      .from('ad_notifications')
      .select(`
        company_id,
        companies!inner(id, name, email),
        users!inner(id, name, email),
        sent_at,
        delivery_method,
        delivered,
        read_at
      `)
      .eq('advertisement_id', adId)
      .order('sent_at', { ascending: false })
      .limit(100);

    // Aggregate statistics
    const uniqueCompanies = new Set();
    const uniqueUsers = new Set();

    (viewsData || []).forEach((v: any) => {
      if (v.company_id) uniqueCompanies.add(v.company_id);
      if (v.user_id) uniqueUsers.add(v.user_id);
    });

    return success({
      ad,
      statistics: {
        totalViews: ad?.views || 0,
        totalClicks: ad?.clicks || 0,
        totalNotifications: ad?.notifications_sent || 0,
        uniqueCompaniesViewed: uniqueCompanies.size,
        uniqueUsersViewed: uniqueUsers.size,
      },
      views: viewsData || [],
      clicks: clicksData || [],
      notifications: notificationsData || [],
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

// Record ad view
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { advertisement_id, company_id, user_id } = body;

    if (!advertisement_id || !company_id) {
      return error('advertisement_id و company_id مطلوبان');
    }

    const s = sb();

    // Check if already viewed
    const { data: existing } = await s.from('ad_views')
      .select('id')
      .eq('advertisement_id', advertisement_id)
      .eq('company_id', company_id)
      .maybeSingle();

    if (existing) {
      return success({ already_viewed: true });
    }

    // Record view
    const { data, error: insertError } = await s.from('ad_views')
      .insert({
        advertisement_id,
        company_id,
        user_id: user_id || null,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return success({ recorded: true, view: data });
  } catch (e: any) {
    return serverError(e);
  }
}

// Record ad click
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { advertisement_id, company_id, user_id } = body;

    if (!advertisement_id || !company_id) {
      return error('advertisement_id و company_id مطلوبان');
    }

    const s = sb();

    // Check if already clicked
    const { data: existing } = await s.from('ad_clicks')
      .select('id')
      .eq('advertisement_id', advertisement_id)
      .eq('company_id', company_id)
      .maybeSingle();

    if (existing) {
      return success({ already_clicked: true });
    }

    // Record click
    const { data, error: insertError } = await s.from('ad_clicks')
      .insert({
        advertisement_id,
        company_id,
        user_id: user_id || null,
        ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
        user_agent: req.headers.get('user-agent') || null,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return success({ recorded: true, click: data });
  } catch (e: any) {
    return serverError(e);
  }
}