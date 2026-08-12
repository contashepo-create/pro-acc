import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { equipmentCostSchema } from '@/lib/validation';
import { logAudit } from '@/lib/audit';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed-assets', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('project_id');

    let q = s.from('equipment_costs')
      .select('*, projects(name), fixed_assets(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (projectId) q = q.eq('project_id', projectId);

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await q.order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (err) throw err;

    return success({ rows: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed-assets', 'create');
    const body = await parseBody(request);
    const parsed = equipmentCostSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const s = sb();
    const { data, error: insErr } = await s.from('equipment_costs')
      .insert({
        company_id: auth.companyId,
        equipment_id: parsed.data.equipment_id || null,
        project_id: parsed.data.project_id || null,
        date: parsed.data.date || new Date().toISOString().split('T')[0],
        cost_type: parsed.data.cost_type,
        amount: parsed.data.amount,
        usage_hours: parsed.data.usage_hours || 0,
        notes: parsed.data.notes || null,
        created_by: auth.userId,
      })
      .select('id, date, cost_type, amount, project_id').single();
    if (insErr || !data) return error('فشل تسجيل تكلفة المعدة', 500);

    await logAudit({
      company_id: auth.companyId, user_id: auth.userId,
      entity_type: 'equipment_cost', entity_id: data.id, action: 'create',
      after: data, summary: `تسجيل تكلفة معدات (${data.cost_type}) ${data.amount}`,
    });

    return success({ row: data }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
