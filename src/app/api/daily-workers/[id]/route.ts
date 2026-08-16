import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { dailyWorkerUpdateSchema, deliveryUuid } from '@/lib/project-delivery-validation';

async function findWorker(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('daily_workers')
    .select('id,name,phone,daily_wage,is_active,created_at,updated_at').eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'employees', 'read');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف العامل غير صالح');
    const worker = await findWorker(auth.companyId, id);
    return worker ? success(worker) : error('العامل غير موجود', 404);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'employees', 'update');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف العامل غير صالح');
    const parsed = dailyWorkerUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات العامل غير صالحة');
    if (!await findWorker(auth.companyId, id)) return error('العامل غير موجود', 404);
    const { data, error: rpcError } = await getSupabase().rpc('update_daily_worker_atomic', {
      p_company_id: auth.companyId, p_worker_id: id, p_patch: parsed.data, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'employees', 'delete');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف العامل غير صالح');
    if (!await findWorker(auth.companyId, id)) return error('العامل غير موجود', 404);
    const { data, error: rpcError } = await getSupabase().rpc('deactivate_daily_worker_atomic', {
      p_company_id: auth.companyId, p_worker_id: id, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
