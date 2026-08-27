import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { changeOrderSchema } from '@/lib/validation';
import { deliveryUuid } from '@/lib/project-delivery-validation';

const CHANGE_COLUMNS = `id,project_id,number,title,description,status,change_amount,base_contract_amount,
  new_contract_amount,created_by,approved_by,approved_at,created_at,updated_at,projects(name),users(name)`;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('project_id');
    if (projectId && !deliveryUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');
    let query = getSupabase().from('change_orders').select(CHANGE_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    return success({ rows: data || [], total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'create');
    const parsed = changeOrderSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات أمر التغيير غير صالحة');
    if (!['draft', 'submitted'].includes(parsed.data.status)) return error('يجب إنشاء أمر التغيير كمسودة أو مُرسل');
    const { data, error: rpcError } = await getSupabase().rpc('create_change_order_atomic', {
      p_company_id: auth.companyId,
      p_project_id: parsed.data.project_id,
      p_title: parsed.data.title,
      p_description: parsed.data.description || '',
      p_change_amount: parsed.data.change_amount,
      p_status: parsed.data.status,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success({ row: data }, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
