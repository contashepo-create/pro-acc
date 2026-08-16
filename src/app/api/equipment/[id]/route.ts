import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid, equipmentUpdateSchema } from '@/lib/project-delivery-validation';

const DETAIL_COLUMNS = `id,name,type,model,manufacturer,year_of_manufacture,serial_number,plate_number,purchase_date,
  purchase_cost,depreciation_method,useful_life_years,hourly_rate,assigned_project_id,assigned_operator_id,status,
  location,notes,last_maintenance_date,next_maintenance_date,maintenance_interval_days,total_operating_hours,
  current_value,created_at,updated_at,projects(name),employees(name)`;

async function findEquipment(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('equipment').select(DETAIL_COLUMNS)
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'read');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المعدة غير صالح');
    const equipment = await findEquipment(auth.companyId, id);
    if (!equipment) return error('المعدة غير موجودة', 404);
    const supabase = getSupabase();
    const [{ data: maintenance, error: maintenanceError }, { data: usage, error: usageError }] = await Promise.all([
      supabase.from('equipment_maintenance')
        .select('id,maintenance_date,type,description,cost,performed_by,next_maintenance_date,parts_replaced,created_at')
        .eq('equipment_id', id).eq('company_id', auth.companyId).order('maintenance_date', { ascending: false }).limit(20),
      supabase.from('equipment_usage')
        .select('id,project_id,operator_id,start_date,end_date,start_hours,end_hours,total_hours,notes,created_at,projects(name),employees(name)')
        .eq('equipment_id', id).eq('company_id', auth.companyId).order('start_date', { ascending: false }).limit(20),
    ]);
    if (maintenanceError) throw maintenanceError;
    if (usageError) throw usageError;
    return success({ ...equipment, maintenance_history: maintenance || [], usage_history: usage || [] });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'update');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المعدة غير صالح');
    const parsed = equipmentUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات المعدة غير صالحة');
    if (!await findEquipment(auth.companyId, id)) return error('المعدة غير موجودة', 404);
    const { data, error: rpcError } = await getSupabase().rpc('update_equipment_atomic', {
      p_company_id: auth.companyId, p_equipment_id: id, p_patch: parsed.data, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'delete');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المعدة غير صالح');
    if (!await findEquipment(auth.companyId, id)) return error('المعدة غير موجودة', 404);
    const { data, error: rpcError } = await getSupabase().rpc('decommission_equipment_atomic', {
      p_company_id: auth.companyId, p_equipment_id: id, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
