import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const projectId = req.nextUrl.searchParams.get('projectId');
    const { page, pageSize } = getPaginationParams(req.url);

    let query = s.from('boq_items')
      .select('*, projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('item_code').range(offset, offset + pageSize - 1);

    if (queryError) {
      // Table might not exist, return empty result
      console.warn('BOQ items table query error:', queryError);
      return success({ boqItems: [], total: 0, page, pageSize });
    }

    const boqItems = (data || []).map((b: any) => ({ ...b, project_name: b.projects?.name || null }));
    return success({ boqItems, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { project_id, item_code, description, unit, quantity, unit_price } = data;
    if (!project_id || !item_code || !description || !unit || !quantity || unit_price == null)
      return error('project_id, item_code, description, unit, quantity, unit_price are required');

    const { data: result, error: insertError } = await s.from('boq_items')
      .insert({ company_id: auth.companyId, project_id, item_code, description, unit, quantity, unit_price, total: quantity * unit_price })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
