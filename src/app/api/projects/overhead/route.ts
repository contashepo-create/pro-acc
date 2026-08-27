import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireRole, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { validateOverheadRule } from '@/lib/project-overhead';

const sb = () => getSupabase();
const ROW_COLUMNS = 'id, name, allocation_basis, rate, is_active, created_at, updated_at';

/** GET /api/projects/overhead — list the company's overhead allocation rules. */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const onlyActive = url.searchParams.get('active') === 'true';
    let query = sb().from('overhead_allocations')
      .select(ROW_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (onlyActive) query = query.eq('is_active', true);
    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await query.order('created_at', { ascending: true }).range(offset, offset + pageSize - 1);
    if (err) throw err;
    return success({ rows: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/projects/overhead — create a new overhead allocation rule. */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRole(req, ['admin', 'manager']);
    const body = await parseBody(req);
    if (!body.name || !body.allocation_basis || body.rate === undefined) {
      return error('الاسم وأساس التخصيص والنسبة مطلوبة');
    }
    const check = validateOverheadRule(body);
    if (typeof check === 'string') return error(check);
    const name = String(body.name).trim();
    const rate = Number(body.rate);
    const basis = body.allocation_basis;

    const { data: dup } = await sb().from('overhead_allocations').select('id')
      .eq('company_id', auth.companyId).eq('name', name).maybeSingle();
    if (dup) return error('يوجد قاعدة تخصيص بنفس الاسم', 409);

    const { data, error: err } = await sb().from('overhead_allocations').insert({
      company_id: auth.companyId,
      name,
      allocation_basis: basis,
      rate,
      is_active: body.is_active !== undefined ? body.is_active : true,
    }).select(ROW_COLUMNS).single();
    if (err) throw err;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
