import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, getPaginationParams } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const { page, pageSize } = getPaginationParams(request.url);
    const companyId = request.nextUrl.searchParams.get('company_id');
    const s = sb();

    let countBuilder = s.from('users').select('*', { count: 'exact', head: true });
    if (companyId) {
      countBuilder = countBuilder.eq('company_id', companyId);
    }
    const { count: total, error: countErr } = await countBuilder;
    if (countErr) throw countErr;

    let dataBuilder = s.from('users')
      .select('id, name, email, role, is_active, last_login, created_at, company_id')
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (companyId) {
      dataBuilder = dataBuilder.eq('company_id', companyId);
    }

    const { data: users, error: err } = await dataBuilder;
    if (err) throw err;

    // Get company names
    const companyIds = (users || []).map((u: any) => u.company_id).filter(Boolean);
    let companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await s.from('companies')
        .select('id, name')
        .in('id', [...new Set(companyIds)]);
      (companies || []).forEach((c: any) => { companyMap[c.id] = c.name; });
    }

    const result = (users || []).map((u: any) => ({
      ...u,
      company_name: companyMap[u.company_id] || null,
    }));

    return success({
      users: result,
      total: total || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return serverError(err);
  }
}
