import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid, equipmentMaintenanceSchema } from '@/lib/project-delivery-validation';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'update');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المعدة غير صالح');
    const parsed = equipmentMaintenanceSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الصيانة غير صالحة');
    const { data: equipment, error: queryError } = await getSupabase().from('equipment').select('id')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!equipment) return error('المعدة غير موجودة', 404);
    const { data, error: rpcError } = await getSupabase().rpc('record_equipment_maintenance_atomic', {
      p_company_id: auth.companyId, p_equipment_id: id, p_date: parsed.data.maintenance_date,
      p_type: parsed.data.type || 'routine', p_description: parsed.data.description,
      p_cost: parsed.data.cost || 0, p_performed_by: parsed.data.performed_by || '',
      p_next_date: parsed.data.next_maintenance_date || null, p_parts: parsed.data.parts_replaced || '',
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
