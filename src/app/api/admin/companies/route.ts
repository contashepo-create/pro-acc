import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, getPaginationParams, handleApiError } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const { page, pageSize } = getPaginationParams(request.url);
    const s = sb();

    const { count: total, error: countErr } = await s.from('companies')
      .select('*', { count: 'exact', head: true });
    if (countErr) throw countErr;

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: companies, error: err } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active, created_at, country, country_code, currency_code, vat_rate')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (err) throw err;

    const companyIds = (companies || []).map((c: any) => c.id);

    // Get user counts per company
    const userCountMap: Record<string, number> = {};
    if (companyIds.length > 0) {
      const { data: users } = await s.from('users')
        .select('company_id')
        .in('company_id', companyIds);
      (users || []).forEach((u: any) => {
        userCountMap[u.company_id] = (userCountMap[u.company_id] || 0) + 1;
      });
    }

    // Get subscription info per company
    const subMap: Record<string, any> = {};
    if (companyIds.length > 0) {
      const { data: subs } = await s.from('subscriptions')
        .select('id, company_id, subscriber_number, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew, subscription_plans(name, max_users, max_projects)')
        .in('company_id', companyIds)
        .order('created_at', { ascending: false });
      (subs || []).forEach((sub: any) => {
        if (!subMap[sub.company_id]) {
          const sp = sub.subscription_plans;
          subMap[sub.company_id] = {
            subscriber_number: sub.subscriber_number,
            plan_code: sub.plan_code,
            plan_name: sp?.name || sub.plan_code || '—',
            status: sub.status,
            start_date: sub.start_date,
            end_date: sub.end_date,
            auto_renew: sub.auto_renew,
            max_users: sp?.max_users,
            max_projects: sp?.max_projects,
          };
        }
      });
    }

    const result = (companies || []).map((c: any) => ({
      ...c,
      user_count: userCountMap[c.id] || 0,
      subscription: subMap[c.id] || null,
    }));

    return success({
      companies: result,
      total: total || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return serverError(err);
  }
}
