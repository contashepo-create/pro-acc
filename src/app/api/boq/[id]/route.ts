import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { boqUpdateSchema, deliveryUuid } from '@/lib/project-delivery-validation';

import type { Row } from '@/lib/types';

async function findItem(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('boq_items')
    .select('id,project_id,item_code,code,description,unit,quantity,unit_price,total,parent_id,level,created_at,projects(name)')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'read');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف بند المقايسة غير صالح');
    const item = await findItem(auth.companyId, id);
    if (!item) return notFound();
    return success({ ...item, project_name: (item as Row).projects ? String(((item as Row).projects as Row).name) || null : null, projects: undefined });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'update');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف بند المقايسة غير صالح');
    const parsed = boqUpdateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات بند المقايسة غير صالحة');
    if (!await findItem(auth.companyId, id)) return notFound();
    const { code, ...rest } = parsed.data;
    const patch = { ...rest, ...(parsed.data.item_code || code ? { item_code: parsed.data.item_code || code } : {}) };
    const { data, error: rpcError } = await getSupabase().rpc('update_boq_item_atomic', {
      p_company_id: auth.companyId, p_item_id: id, p_patch: patch, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'delete');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف بند المقايسة غير صالح');
    if (!await findItem(auth.companyId, id)) return notFound();
    const { data, error: rpcError } = await getSupabase().rpc('delete_boq_item_atomic', {
      p_company_id: auth.companyId, p_item_id: id, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
