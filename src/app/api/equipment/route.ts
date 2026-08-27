import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid, equipmentCreateSchema } from '@/lib/project-delivery-validation';

const EQUIPMENT_COLUMNS = `id,name,type,model,manufacturer,year_of_manufacture,serial_number,plate_number,purchase_date,
  purchase_cost,depreciation_method,useful_life_years,hourly_rate,assigned_project_id,assigned_operator_id,status,
  location,notes,last_maintenance_date,next_maintenance_date,maintenance_interval_days,total_operating_hours,
  current_value,created_at,updated_at,projects(name),employees(name)`;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');
    const projectId = url.searchParams.get('project_id');
    if (status && !['available', 'in_use', 'maintenance', 'decommissioned', 'sold'].includes(status)) return error('حالة المعدة غير صالحة');
    if (projectId && !deliveryUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');
    let query = getSupabase().from('equipment').select(EQUIPMENT_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);
    if (projectId) query = query.eq('assigned_project_id', projectId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    return success({ equipment: data || [], total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'create');
    const parsed = equipmentCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات المعدة غير صالحة');
    const { data, error: rpcError } = await getSupabase().rpc('create_equipment_atomic', {
      p_company_id: auth.companyId, p_payload: parsed.data, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
