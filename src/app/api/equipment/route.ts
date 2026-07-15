import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/equipment — List all equipment
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');
    const project_id = url.searchParams.get('project_id');

    let query = s.from('equipment')
      .select('*, projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (status) query = query.eq('status', status);
    if (project_id) query = query.eq('assigned_project_id', project_id);

    const offset = (page - 1) * pageSize;
    const { data, error: qErr, count } = await query
      .order('name')
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    const equipment = (data || []).map((e: any) => ({
      ...e,
      project_name: e.projects?.name || null,
      nextMaintenanceDue: calculateNextMaintenance(e.last_maintenance_date, e.maintenance_interval_days),
      isOverdue: isMaintenanceOverdue(e.last_maintenance_date, e.maintenance_interval_days),
    }));

    return success({ equipment, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/equipment — Create new equipment
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.name || !body.type) {
      return error('اسم المعدة ونوعها مطلوبان');
    }

    const equipId = generateId();
    const { data, error: insertErr } = await s.from('equipment')
      .insert({
        id: equipId,
        company_id: auth.companyId,
        name: body.name,
        type: body.type, // excavator, crane, mixer, truck, generator, etc.
        model: body.model || null,
        manufacturer: body.manufacturer || null,
        year_of_manufacture: body.year_of_manufacture || null,
        serial_number: body.serial_number || null,
        plate_number: body.plate_number || null,
        purchase_date: body.purchase_date || null,
        purchase_cost: body.purchase_cost || 0,
        depreciation_method: body.depreciation_method || 'straight_line', // straight_line, declining_balance
        useful_life_years: body.useful_life_years || 10,
        hourly_rate: body.hourly_rate || 0,
        assigned_project_id: body.assigned_project_id || null,
        assigned_operator_id: body.assigned_operator_id || null,
        status: body.status || 'available', // available, in_use, maintenance, decommissioned
        location: body.location || null,
        notes: body.notes || null,
        last_maintenance_date: body.last_maintenance_date || null,
        maintenance_interval_days: body.maintenance_interval_days || 90,
        created_by: auth.userId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

function calculateNextMaintenance(lastDate: string | null, intervalDays: number | null): string | null {
  if (!lastDate || !intervalDays) return null;
  const next = new Date(lastDate);
  next.setDate(next.getDate() + intervalDays);
  return next.toISOString().split('T')[0];
}

function isMaintenanceOverdue(lastDate: string | null, intervalDays: number | null): boolean {
  if (!lastDate || !intervalDays) return false;
  const next = new Date(lastDate);
  next.setDate(next.getDate() + intervalDays);
  return next < new Date();
}
