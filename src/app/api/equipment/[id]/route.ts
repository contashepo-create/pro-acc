import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
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
      .order('maintenance_date', { ascending: false });

    // Get usage log
    const { data: usageLog } = await s.from('equipment_usage')
      .select('*, projects(name)')
      .eq('equipment_id', id)
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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    await s.from('equipment_maintenance').delete().eq('equipment_id', id);
    await s.from('equipment_usage').delete().eq('equipment_id', id);
    await s.from('equipment').delete().eq('id', id).eq('company_id', auth.companyId);

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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    if (!body.maintenance_date || !body.description) {
      return error('تاريخ الصيانة والوصف مطلوبان');
    }

    const logId = generateId();
    const { data, error: insertErr } = await s.from('equipment_maintenance')
      .insert({
        id: logId,
        equipment_id: id,
        company_id: auth.companyId,
        maintenance_date: body.maintenance_date,
        type: body.type || 'routine', // routine, repair, inspection, overhaul
        description: body.description,
        cost: body.cost || 0,
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
      .eq('id', id);

    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT with action=record_usage — Log equipment usage hours
 */
async function recordUsage(s: any, equipmentId: string, companyId: string, userId: string, body: any) {
  if (!body.date || !body.hours) {
    throw new Error('التاريخ وعدد الساعات مطلوبان');
  }

  const usageId = generateId();
  const hourlyRate = body.hourly_rate || 0;
  const totalCost = parseFloat(body.hours) * parseFloat(hourlyRate);

  const { data, error: insertErr } = await s.from('equipment_usage')
    .insert({
      id: usageId,
      equipment_id: equipmentId,
      company_id: companyId,
      date: body.date,
      hours: body.hours,
      project_id: body.project_id || null,
      operator_id: body.operator_id || null,
      description: body.description || null,
      hourly_rate: hourlyRate,
      total_cost: totalCost,
      created_by: userId,
    })
    .select()
    .single();

  if (insertErr) throw insertErr;
  return data;
}
