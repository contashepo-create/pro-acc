import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { changeOrderSchema } from '@/lib/validation';
import { applyChangeOrder } from '@/lib/construction';
import { logAudit } from '@/lib/audit';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('project_id');

    let q = s.from('change_orders')
      .select('*, projects(name), users(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (projectId) q = q.eq('project_id', projectId);

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await q.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (err) throw err;

    return success({ rows: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'create');
    const body = await parseBody(request);
    const parsed = changeOrderSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { project_id, change_amount, status, title, description } = parsed.data;
    const s = sb();

    // Load current contract value of the project.
    const { data: project, error: projErr } = await s.from('projects')
      .select('id, contract_value')
      .eq('id', project_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (projErr || !project) return error('المشروع غير موجود', 404);

    const base = parseFloat(String(project.contract_value)) || 0;
    const { adjustedContractAmount, newContractAmount } = applyChangeOrder({ baseContractAmount: base, changeAmount: change_amount });

    // Generate a sequential change-order number per company.
    const { count } = await s.from('change_orders').select('id', { count: 'exact', head: true }).eq('company_id', auth.companyId);
    const number = `CO-${String((count || 0) + 1).padStart(4, '0')}`;

    const { data, error: insErr } = await s.from('change_orders')
      .insert({
        company_id: auth.companyId, project_id, title, description: description || null,
        change_amount, base_contract_amount: base, new_contract_amount: adjustedContractAmount,
        number, status: status || 'draft', created_by: auth.userId,
      })
      .select('id, number, change_amount, new_contract_amount').single();
    if (insErr || !data) return error('فشل إنشاء أمر التغيير', 500);

    // Audit trail
    await logAudit({
      company_id: auth.companyId, user_id: auth.userId,
      entity_type: 'change_order', entity_id: data.id, action: 'create',
      after: data, summary: `إنشاء أمر تغيير ${data.number} بقيمة ${newContractAmount}`,
    });

    return success({ row: data }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
