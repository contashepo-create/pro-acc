import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError } from '@/lib/api-helpers';

const sb = () => getSupabase();



export async function GET(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status');
    const s = sb();

    let queryBuilder = s.from('subscriptions').select('*');
    if (status) {
      queryBuilder = queryBuilder.eq('status', status);
    }
    queryBuilder = queryBuilder.order('created_at', { ascending: false });
    const { data: subscriptions, error: err } = await queryBuilder;
    if (err) throw err;

    const companyIds = (subscriptions || []).map((s: any) => s.company_id).filter(Boolean);
    let companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await s.from('companies')
        .select('id, name')
        .in('id', [...new Set(companyIds)]);
      (companies || []).forEach((c: any) => { companyMap[c.id] = c.name; });
      companyMap = Object.fromEntries((companies || []).map((c: any) => [c.id, c.name]));
    }

    const result = (subscriptions || []).map((sub: any) => ({
      ...sub,
      company_name: companyMap[sub.company_id] || null,
    }));

    return success({ subscriptions: result });
  } catch (e) {
    return adminJsonError(e);
  }
}
