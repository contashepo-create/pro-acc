import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { dailyWorkerCreateSchema } from '@/lib/project-delivery-validation';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'employees', 'read');
    const { page, pageSize } = getPaginationParams(new URL(request.url));
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await getSupabase().from('daily_workers')
      .select('id,name,phone,daily_wage,is_active,created_at,updated_at', { count: 'exact' })
      .eq('company_id', auth.companyId).eq('is_active', true).order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    return success({ workers: data || [], total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'employees', 'create');
    const parsed = dailyWorkerCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات العامل غير صالحة');
    const { data, error: rpcError } = await getSupabase().rpc('create_daily_worker_atomic', {
      p_company_id: auth.companyId, p_name: parsed.data.name, p_phone: parsed.data.phone || '',
      p_daily_wage: parsed.data.daily_wage, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
