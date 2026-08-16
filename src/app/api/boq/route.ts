import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { boqCreateSchema, deliveryUuid } from '@/lib/project-delivery-validation';

const BOQ_COLUMNS = 'id,project_id,item_code,code,description,unit,quantity,unit_price,total,parent_id,level,created_at,projects(name)';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'read');
    const projectId = new URL(req.url).searchParams.get('projectId');
    if (projectId && !deliveryUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');
    const { page, pageSize } = getPaginationParams(new URL(req.url));
    let query = getSupabase().from('boq_items').select(BOQ_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('item_code').range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const items = (data || []).map((item: any) => ({
      ...item, project_name: item.projects?.name || null, projects: undefined,
    }));
    return success({ items, boqItems: items, total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'create');
    const parsed = boqCreateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات بند المقايسة غير صالحة');
    const input = parsed.data;
    const { data, error: rpcError } = await getSupabase().rpc('create_boq_item_atomic', {
      p_company_id: auth.companyId,
      p_project_id: input.project_id,
      p_item_code: input.item_code || input.code,
      p_description: input.description,
      p_unit: input.unit,
      p_quantity: input.quantity,
      p_unit_price: input.unit_price,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
