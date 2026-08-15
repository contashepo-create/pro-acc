import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { equipmentCostSchema } from '@/lib/validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'read');
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
    const auth = await requireModulePermission(request, 'fixed_assets', 'create');
    const body = await parseBody(request);
    const parsed = equipmentCostSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const s = sb();

    // Equipment/project/account checks, posting, linkage and audit commit in
    // one transaction. Depreciation defaults to 5260/1290; cash costs default
    // to their type-specific expense and 1110 unless explicit accounts arrive.
    const { data, error: postErr } = await s.rpc('post_equipment_cost', {
      p_company_id: auth.companyId,
      p_equipment_id: parsed.data.equipment_id || null,
      p_project_id: parsed.data.project_id || null,
      p_date: parsed.data.date || new Date().toISOString().slice(0, 10),
      p_cost_type: parsed.data.cost_type,
      p_amount: parsed.data.amount,
      p_usage_hours: parsed.data.usage_hours || 0,
      p_notes: parsed.data.notes || '',
      p_expense_account_id: parsed.data.expense_account_id || null,
      p_payment_account_id: parsed.data.payment_account_id || null,
      p_user_id: auth.userId,
    });
    if (postErr) throw postErr;
    return success({ row: data }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
