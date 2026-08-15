import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'read');
    const { id } = await params;
    const s = sb();

    const { data: equipment } = await s.from('equipment')
      .select('*, projects(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!equipment) return notFound();

    // Get maintenance log
    const { data: maintenanceLog } = await s.from('equipment_maintenance')
      .select('*')
      .eq('equipment_id', id)
      .eq('company_id', auth.companyId)
      .order('maintenance_date', { ascending: false });

    // Get usage log
    const { data: usageLog } = await s.from('equipment_usage')
      .select('*, projects(name)')
      .eq('equipment_id', id)
      .eq('company_id', auth.companyId)
      .order('date', { ascending: false })
      .limit(30);

    const eq = equipment as any;
    return success({
      ...eq,
      project_name: eq.projects?.name || null,
      maintenance_log: maintenanceLog || [],
      usage_log: usageLog || [],
      totalHours: (usageLog || []).reduce((sum: number, u: any) => sum + (parseFloat(u.hours) || 0), 0),
      totalCost: (usageLog || []).reduce((sum: number, u: any) => sum + (parseFloat(u.total_cost) || 0), 0),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();
    const { data: existing } = await s.from('equipment').select('id')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if (body.assigned_project_id) {
      const { data: project } = await s.from('projects').select('id').eq('id', body.assigned_project_id).eq('company_id', auth.companyId).maybeSingle();
      if (!project) return error('المشروع غير موجود',404);
    }
    if (body.assigned_operator_id) {
      const { data: operator } = await s.from('employees').select('id').eq('id', body.assigned_operator_id).eq('company_id', auth.companyId).maybeSingle();
      if (!operator) return error('المشغل غير موجود',404);
    }
    for (const field of ['hourly_rate','maintenance_interval_days','year_of_manufacture']) {
      if (body[field]!==undefined && (!Number.isFinite(Number(body[field])) || Number(body[field])<0)) return error('قيمة رقمية غير صالحة');
    }
    if (body.status && !['available','in_use','maintenance','decommissioned','sold'].includes(body.status)) return error('حالة المعدة غير صالحة');

    const allowedFields = [
      'name', 'type', 'model', 'manufacturer', 'year_of_manufacture',
      'serial_number', 'plate_number', 'hourly_rate', 'assigned_project_id',
      'assigned_operator_id', 'status', 'location', 'notes',
      'last_maintenance_date', 'maintenance_interval_days',
    ];

    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    updateData.updated_at = new Date().toISOString();

    const { data, error: updateErr } = await s.from('equipment')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select()
      .single();

    if (updateErr) throw updateErr;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: equipment } = await s.from('equipment').select('id, status')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!equipment) return notFound();
    const [{ data: maintenance }, { data: usage }] = await Promise.all([
      s.from('equipment_maintenance').select('id').eq('equipment_id', id).eq('company_id', auth.companyId).limit(1),
      s.from('equipment_usage').select('id').eq('equipment_id', id).eq('company_id', auth.companyId).limit(1),
    ]);
    if (maintenance?.length || usage?.length) {
      const { error: updateError } = await s.from('equipment').update({ status: 'decommissioned', updated_at: new Date().toISOString() })
        .eq('id', id).eq('company_id', auth.companyId);
      if (updateError) throw updateError;
      return success({ decommissioned: true });
    }
    const { error: deleteError } = await s.from('equipment').delete().eq('id', id).eq('company_id', auth.companyId);
    if (deleteError) throw deleteError;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/equipment/[id]/maintenance — Log maintenance
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'equipment', 'create');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    if (!body.maintenance_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.maintenance_date) || typeof body.description!=='string' || !body.description.trim() || body.description.length>2000) {
      return error('تاريخ الصيانة والوصف غير صالحين');
    }
    if (body.type && !['routine','repair','inspection','overhaul'].includes(body.type)) return error('نوع الصيانة غير صالح');
    const cost=Number(body.cost||0);
    if (!Number.isFinite(cost) || cost<0 || Math.abs(cost*100-Math.round(cost*100))>1e-8) return error('تكلفة الصيانة غير صالحة');
    const { data: equipment } = await s.from('equipment').select('id, status')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!equipment) return notFound();
    if ((equipment as any).status==='sold' || (equipment as any).status==='decommissioned') return error('لا يمكن تسجيل صيانة لمعدة مستبعدة',409);

    const logId = generateId();
    const { data, error: insertErr } = await s.from('equipment_maintenance')
      .insert({
        id: logId,
        equipment_id: id,
        company_id: auth.companyId,
        maintenance_date: body.maintenance_date,
        type: body.type || 'routine', // routine, repair, inspection, overhaul
        description: body.description,
        cost,
        performed_by: body.performed_by || null,
        next_maintenance_date: body.next_maintenance_date || null,
        parts_replaced: body.parts_replaced || null,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Update equipment last maintenance date
    await s.from('equipment')
      .update({ last_maintenance_date: body.maintenance_date, updated_at: new Date().toISOString() })
      .eq('id', id).eq('company_id', auth.companyId);

    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
