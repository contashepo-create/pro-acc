import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { equipmentCostSchema } from '@/lib/validation';
import { deliveryUuid } from '@/lib/project-delivery-validation';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('project_id');
    if (projectId && !deliveryUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');
    let query = getSupabase().from('equipment_costs')
      .select('id,equipment_id,project_id,date,cost_type,amount,usage_hours,notes,journal_entry_id,created_at,projects(name),fixed_assets(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    return success({ rows: data || [], total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'create');
    const parsed = equipmentCostSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات تكلفة المعدة غير صالحة');
    const input = parsed.data;
    const { data, error: rpcError } = await getSupabase().rpc('post_equipment_cost', {
      p_company_id: auth.companyId, p_equipment_id: input.equipment_id || null, p_project_id: input.project_id || null,
      p_date: input.date || new Date().toISOString().slice(0, 10), p_cost_type: input.cost_type,
      p_amount: input.amount, p_usage_hours: input.usage_hours || 0, p_notes: input.notes || '',
      p_expense_account_id: input.expense_account_id || null, p_payment_account_id: input.payment_account_id || null,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success({ row: data }, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
