import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { verifyToken } from '@/lib/auth';

const sb = () => getSupabase();

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
  return payload;
}

export async function GET(request: NextRequest) {
  try {
    const admin = requireAdmin(request);
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'ads';
    const startDate = url.searchParams.get('start');
    const endDate = url.searchParams.get('end');

    const s = sb();

    if (type === 'ads') {
      // Get advertisement report data
      let query = s.from('advertisements')
        .select(`
          id, title, type, display_mode, views, clicks, notifications_sent,
          created_at, updated_at
        `)
        .order('created_at', { ascending: false });

      // Filter by date range if provided
      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate);
      }

      const { data: ads } = await query;

      // Get detailed statistics for each ad
      const enrichedAds = await Promise.all(
        (ads || []).map(async (ad: any) => {
          const { data: views } = await s.from('ad_views')
            .select('user_id, company_id, viewed_at')
            .eq('advertisement_id', ad.id);

          const { data: clicks } = await s.from('ad_clicks')
            .select('user_id, company_id, clicked_at')
            .eq('advertisement_id', ad.id);

          const { data: notifications } = await s.from('ad_notifications')
            .select('user_id, company_id, sent_at')
            .eq('advertisement_id', ad.id);

          const uniqueUsers = new Set((views || []).map((v: any) => v.user_id));
          const uniqueCompanies = new Set((views || []).map((v: any) => v.company_id));

          return {
            ...ad,
            unique_users: uniqueUsers.size,
            unique_companies: uniqueCompanies.size,
            ctr: calculateCTR(ad.views || 0, ad.clicks || 0),
          };
        })
      );

      return success(enrichedAds);
    } else if (type === 'approvals') {
      // Get approval report data
      let query = s.from('approval_requests')
        .select(`
          id, transaction_type, amount, requester_id, status,
          created_at, approved_at
        `)
        .order('created_at', { ascending: false });

      // Filter by date range if provided
      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate);
      }

      const { data: approvals } = await query;

      // Enrich with user data
      const enrichedApprovals = await Promise.all(
        (approvals || []).map(async (approval: any) => {
          const { data: requester } = await s.from('users')
            .select('name')
            .eq('id', approval.requester_id)
            .single();

          return {
            ...approval,
            requester_name: requester?.name || 'غير معروف',
          };
        })
      );

      return success(enrichedApprovals);
    } else {
      return error('نوع التقرير غير صالح', 400);
    }
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

function calculateCTR(views: number, clicks: number): number {
  if (views === 0) return 0;
  return (clicks / views) * 100;
}