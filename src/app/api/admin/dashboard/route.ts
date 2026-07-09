import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const s = sb();

    // Get counts
    const { count: companiesCount } = await s.from('companies').select('id', { count: 'exact', head: true });
    const { count: usersCount } = await s.from('users').select('id', { count: 'exact', head: true });
    const { count: activeSubs } = await s.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active');

    // Get recent companies
    const { data: recentCompanies } = await s.from('companies')
      .select('id, name, is_active, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get recent subscriptions
    const { data: recentSubs } = await s.from('subscriptions')
      .select('id, company_id, plan_code, status, end_date')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get plans
    const { data: plans } = await s.from('subscription_plans')
      .select('id, name, price, is_active')
      .order('price');

    // Get unused activation codes
    const { count: unusedCodes } = await s.from('activation_codes')
      .select('id', { count: 'exact', head: true })
      .eq('used_by', null);

    // Get recent activity from audit log
    const { data: activity } = await s.from('admin_audit_log')
      .select('action, details, timestamp')
      .order('timestamp', { ascending: false })
      .limit(10);

    return success({
      companiesCount: companiesCount || 0,
      usersCount: usersCount || 0,
      activeSubscriptions: activeSubs || 0,
      monthlyRevenue: 0,
      unusedCodes: unusedCodes || 0,
      dbSize: 'N/A',
      lastLogin: null,
      recentActivity: activity || [],
      recentCompanies: recentCompanies || [],
      recentSubscriptions: recentSubs || [],
      planDistribution: plans || [],
      systemHealth: {
        apiResponseTime: 'N/A',
        uptime: 'N/A',
        dbStatus: 'Connected',
      },
    });
  } catch (err) {
    return error('حدث خطأ في الخادم', 500);
  }
}
