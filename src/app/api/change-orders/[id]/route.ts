import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { changeOrderUpdateSchema } from '@/lib/validation';
import { deliveryUuid } from '@/lib/project-delivery-validation';

async function findOrder(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('change_orders')
    .select('id,project_id,number,title,description,status,change_amount,base_contract_amount,new_contract_amount,created_by,approved_by,approved_at,created_at,updated_at,projects(name)')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف أمر التغيير غير صالح');
    const order = await findOrder(auth.companyId, id);
    return order ? success(order) : error('أمر التغيير غير موجود', 404);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'update');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف أمر التغيير غير صالح');
    const parsed = changeOrderUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success || Object.keys(parsed.data || {}).length === 0) return error(parsed.success ? 'لا توجد تغييرات' : parsed.error.issues[0]?.message);
    const current = await findOrder(auth.companyId, id);
    if (!current) return error('أمر التغيير غير موجود', 404);
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([key, value]) => {
      if (key === 'change_amount') return Number(value) !== Number((current as any)[key]);
      return (value ?? null) !== ((current as any)[key] ?? null);
    }));
    if (!Object.keys(patch).length) return error('لا توجد تغييرات');
    const { data, error: rpcError } = await getSupabase().rpc('update_change_order_atomic', {
      p_company_id: auth.companyId, p_order_id: id, p_patch: patch, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success({ row: data });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'delete');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف أمر التغيير غير صالح');
    if (!await findOrder(auth.companyId, id)) return error('أمر التغيير غير موجود', 404);
    const { data, error: rpcError } = await getSupabase().rpc('cancel_change_order_atomic', {
      p_company_id: auth.companyId, p_order_id: id, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success({ row: data });
  } catch (cause) {
    return handleApiError(cause);
  }
}
