import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

const sb = () => getSupabase();

if (!process.env.PRO_ACCOUNTANT_LICENSE_SALT) {
  throw new Error('PRO_ACCOUNTANT_LICENSE_SALT environment variable is required');
}
const SALT = process.env.PRO_ACCOUNTANT_LICENSE_SALT;

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const s = sb();
    const used = req.nextUrl.searchParams.get('used');

    let queryBuilder = s.from('activation_codes').select('*');
    if (used === 'true') {
      queryBuilder = queryBuilder.eq('is_used', true);
    } else if (used === 'false') {
      queryBuilder = queryBuilder.eq('is_used', false);
    }
    queryBuilder = queryBuilder.order('created_at', { ascending: false });

    const { data: codes, error: err } = await queryBuilder;
    if (err) throw err;

    const companyIds = (codes || []).map((c: any) => c.used_by).filter(Boolean);
    const companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await s.from('companies')
        .select('id, name')
        .in('id', companyIds);
      (companies || []).forEach((c: any) => { companyMap[c.id] = c.name; });
    }

    const result = (codes || []).map((c: any) => ({
      ...c,
      company_name: c.used_by ? companyMap[c.used_by] || null : null,
    }));

    return success(result);
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
    const body = await parseBody(req);
    const { companyId, planCode, durationMonths } = body;
    if (!planCode || !durationMonths) return error('planCode and durationMonths required');

    const machineId = companyId || 'web-' + Date.now();
    const raw = `${planCode}-${machineId}-${durationMonths}`;
    const hmac = createHmac('sha256', SALT).update(raw).digest('hex').toUpperCase().slice(0, 16);
    const code = `${planCode}-${machineId.slice(0, 8)}-${durationMonths}-${hmac}`;

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + durationMonths);

    const s = sb();
    const { error: insertErr } = await s.from('activation_codes').insert({
      code,
      plan_code: planCode,
      duration_months: durationMonths,
      expires_at: endDate.toISOString().split('T')[0],
    });
    if (insertErr) throw insertErr;

    return success({ code, planCode, durationMonths });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}
