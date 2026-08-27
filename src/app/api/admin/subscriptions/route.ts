import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error } from '@/lib/api-helpers';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();



export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status');
    if (status && !['active','trial','expired','cancelled'].includes(status)) return error('حالة الاشتراك غير صالحة');
    const s = sb();

    let queryBuilder = s.from('subscriptions').select(
      'id, subscriber_number, company_id, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew, extra_users, extra_branches, extra_storage_gb, addons_json, created_at, updated_at'
    );
    if (status) queryBuilder = queryBuilder.eq('status', status);
    queryBuilder = queryBuilder.order('created_at', { ascending: false }).limit(500);
    const { data: subscriptions, error: err } = await queryBuilder;
    if (err) throw err;

    const companyIds = (subscriptions || []).map((s: Row) => s.company_id).filter(Boolean);
    let companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies, error: companiesError } = await s.from('companies')
        .select('id, name')
        .in('id', [...new Set(companyIds)]);
      if (companiesError) throw companiesError;
      companyMap = Object.fromEntries((companies || []).map((c: Row) => [c.id, c.name]));
    }

    const result = (subscriptions || []).map((sub: Row) => ({
      ...sub,
      company_name: companyMap[String(sub.company_id)] || null,
    }));

    return success({ subscriptions: result });
  } catch (e) {
    return adminJsonError(e);
  }
}
