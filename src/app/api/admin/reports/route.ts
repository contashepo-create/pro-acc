import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();



export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'ads';
    const startDate = url.searchParams.get('start');
    const endDate = url.searchParams.get('end');
    const validDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
    if ((startDate && (!validDate.test(startDate) || Number.isNaN(Date.parse(startDate)))) ||
        (endDate && (!validDate.test(endDate) || Number.isNaN(Date.parse(endDate))))) {
      return error('نطاق التاريخ غير صالح');
    }
    if (startDate && endDate && Date.parse(startDate) > Date.parse(endDate)) return error('بداية النطاق بعد نهايته');

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

      const { data: ads, error: adsError } = await query.limit(500);
      if (adsError) throw adsError;

      // Get detailed statistics for each ad
      const enrichedAds = await Promise.all(
        (ads || []).map(async (ad: any) => {
          // Distinct counts must consider every view. Capping the read at
          // 5,000 rows silently understated reach for any popular ad, and the
          // understatement was invisible because the number still looked
          // plausible. Page through instead of truncating — but keep a hard
          // safety ceiling so a viral ad cannot pin this endpoint forever,
          // and surface any truncation explicitly instead of hiding it.
          const uniqueUsers = new Set<string>();
          const uniqueCompanies = new Set<string>();
          const viewPageSize = 1000;
          const maxViewRows = 100_000;
          let scannedRows = 0;
          let viewsTruncated = false;
          for (let offset = 0; ; offset += viewPageSize) {
            const { data: views, error: viewsError } = await s.from('ad_views')
              .select('user_id, company_id')
              .eq('advertisement_id', ad.id)
              .order('id', { ascending: true })
              .range(offset, offset + viewPageSize - 1);
            if (viewsError) throw viewsError;
            const page = views || [];
            for (const view of page as any[]) {
              if (view.user_id) uniqueUsers.add(view.user_id);
              if (view.company_id) uniqueCompanies.add(view.company_id);
            }
            scannedRows += page.length;
            if (page.length < viewPageSize) break;
            if (scannedRows >= maxViewRows) {
              viewsTruncated = true;
              break;
            }
          }

          return {
            ...ad,
            unique_users: uniqueUsers.size,
            unique_companies: uniqueCompanies.size,
            views_truncated: viewsTruncated,
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

      const { data: approvals, error: approvalsError } = await query.limit(500);
      if (approvalsError) throw approvalsError;

      // Enrich with user data
      const enrichedApprovals = await Promise.all(
        (approvals || []).map(async (approval: Row) => {
          const { data: requester, error: requesterError } = await s.from('users')
            .select('name')
            .eq('id', approval.requester_id)
            .maybeSingle();
          if (requesterError) throw requesterError;

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
  } catch (e: unknown) {
    return adminJsonError(e);
  }
}

function calculateCTR(views: number, clicks: number): number {
  if (views === 0) return 0;
  return (clicks / views) * 100;
}