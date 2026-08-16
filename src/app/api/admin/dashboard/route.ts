import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { success } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

type QueryResult = { error: unknown };

function assertQuery(result: QueryResult): void {
  if (result.error) throw result.error;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const s = sb();

    const [
      companiesResult,
      usersResult,
      subscriptionsResult,
      recentCompaniesResult,
      recentSubscriptionsResult,
      plansResult,
      codesResult,
      activityResult,
    ] = await Promise.all([
      s.from('companies').select('id', { count: 'exact', head: true }),
      s.from('users').select('id', { count: 'exact', head: true }),
      s.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      s.from('companies').select('id, name, is_active, created_at').order('created_at', { ascending: false }).limit(5),
      s.from('subscriptions').select('id, company_id, plan_code, status, end_date').order('created_at', { ascending: false }).limit(5),
      s.from('subscription_plans').select('id, name, price_monthly, is_active').order('price_monthly').limit(100),
      s.from('activation_codes').select('id', { count: 'exact', head: true }).eq('is_used', false),
      s.from('admin_audit_log').select('action, details, created_at').order('created_at', { ascending: false }).limit(10),
    ]);

    [companiesResult, usersResult, subscriptionsResult, recentCompaniesResult,
      recentSubscriptionsResult, plansResult, codesResult, activityResult].forEach(assertQuery);

    const activity = (activityResult.data || []).map((entry: any) => ({
      action: entry.action,
      details: entry.details,
      timestamp: entry.created_at,
    }));

    return success({
      companiesCount: companiesResult.count || 0,
      usersCount: usersResult.count || 0,
      activeSubscriptions: subscriptionsResult.count || 0,
      // Revenue recognition is not inferred from plans or subscriptions. It
      // remains zero until backed by an authoritative ledger aggregation.
      monthlyRevenue: 0,
      unusedCodes: codesResult.count || 0,
      dbSize: 'N/A',
      lastLogin: null,
      recentActivity: activity,
      recentCompanies: recentCompaniesResult.data || [],
      recentSubscriptions: recentSubscriptionsResult.data || [],
      planDistribution: plansResult.data || [],
      systemHealth: {
        apiResponseTime: 'N/A',
        uptime: 'N/A',
        dbStatus: 'Connected',
      },
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
