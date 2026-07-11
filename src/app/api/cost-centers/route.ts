import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody, requireApiAuth, handleApiError, getPaginationParams } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { page, pageSize } = getPaginationParams(req.url);

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await s.from('cost_centers')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .order('code')
      .range(offset, offset + pageSize - 1);

    if (err) throw err;
    return success({ cost_centers: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const body = await parseBody(req);
    const { code, name, description, parent_id } = body;

    if (!code || !name) return error('الكود والاسم مطلوبان');

    const { data, error: err } = await s.from('cost_centers')
      .insert({
        company_id: auth.companyId,
        code: code.toUpperCase(),
        name,
        description: description || null,
        parent_id: parent_id || null,
      })
      .select()
      .single();

    if (err) throw err;

    // Audit log
    await s.from('financial_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'create_cost_center',
      table_name: 'cost_centers',
      record_id: data.id,
      new_values: data,
    });

    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
