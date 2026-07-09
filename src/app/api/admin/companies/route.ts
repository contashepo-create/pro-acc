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
    const s = sb();

    const { count: total, error: countErr } = await s.from('companies')
      .select('*', { count: 'exact', head: true });
    if (countErr) throw countErr;

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: companies, error: err } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active, created_at')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (err) throw err;

    // Get user counts per company
    const companyIds = (companies || []).map((c: any) => c.id);
    let userCountMap: Record<string, number> = {};
    if (companyIds.length > 0) {
      const { data: users } = await s.from('users')
        .select('company_id')
        .in('company_id', companyIds);
      (users || []).forEach((u: any) => {
        userCountMap[u.company_id] = (userCountMap[u.company_id] || 0) + 1;
      });
    }

    const result = (companies || []).map((c: any) => ({
      ...c,
      user_count: userCountMap[c.id] || 0,
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
