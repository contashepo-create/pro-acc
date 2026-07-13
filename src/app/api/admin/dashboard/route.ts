import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const s = sb();

    let companiesCount = 0, usersCount = 0, activeSubs = 0, unusedCodes = 0;
    let recentCompanies: any[] = [], recentSubs: any[] = [], plans: any[] = [], activity: any[] = [];

    try {
      const { count } = await s.from('companies').select('id', { count: 'exact', head: true });
      companiesCount = count || 0;
    } catch (e) { console.warn('dashboard companies count failed', e); }

    try {
      const { count } = await s.from('users').select('id', { count: 'exact', head: true });
      usersCount = count || 0;
    } catch (e) { console.warn('dashboard users count failed', e); }

    try {
      const { count } = await s.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active');
      activeSubs = count || 0;
    } catch (e) { console.warn('dashboard subs count failed', e); }

    try {
      const { data } = await s.from('companies')
        .select('id, name, is_active, created_at')
        .order('created_at', { ascending: false })
        .limit(5);
      recentCompanies = data || [];
    } catch (e) { console.warn('dashboard recent companies failed', e); }

    try {
      const { data } = await s.from('subscriptions')
        .select('id, company_id, plan_code, status, end_date')
        .order('created_at', { ascending: false })
        .limit(5);
      recentSubs = data || [];
    } catch (e) { console.warn('dashboard recent subs failed', e); }

    try {
      // eslint-disable-next-line prefer-const
      let { data, error } = await s.from('subscription_plans')
        .select('id, name, price_monthly, is_active')
        .order('price_monthly');
      if (error) {
        const { data: oldData } = await s.from('subscription_plans')
          .select('id, name, price, is_active')
          .order('price');
        data = oldData as any;
      }
      plans = data || [];
    } catch (e) { console.warn('dashboard plans failed', e); }

    try {
      const { count } = await s.from('activation_codes')
        .select('id', { count: 'exact', head: true })
        .is('used_by', null);
      unusedCodes = count || 0;
    } catch (e) { console.warn('dashboard codes failed', e); }

    try {
      // eslint-disable-next-line prefer-const
      let { data, error } = await s.from('admin_audit_log')
        .select('action, details, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) {
        const { data: oldData } = await s.from('admin_audit_log')
          .select('action, details, timestamp')
          .order('timestamp', { ascending: false })
          .limit(10);
        data = oldData as any;
      }
      // Normalize to timestamp field for frontend
      activity = (data || []).map((a: any) => ({
        action: a.action,
        details: a.details,
        timestamp: a.timestamp || a.created_at,
      }));
    } catch (e) { console.warn('dashboard activity failed', e); }

    return success({
      companiesCount,
      usersCount,
      activeSubscriptions: activeSubs,
      monthlyRevenue: 0,
      unusedCodes,
      dbSize: 'N/A',
      lastLogin: null,
      recentActivity: activity,
      recentCompanies,
      recentSubscriptions: recentSubs,
      planDistribution: plans,
      systemHealth: {
        apiResponseTime: 'N/A',
        uptime: 'N/A',
        dbStatus: 'Connected',
      },
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    return error('حدث خطأ في الخادم', 500);
  }
}
