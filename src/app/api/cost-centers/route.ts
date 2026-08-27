import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody, handleApiError, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { logAudit } from '@/lib/audit';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'cost_centers', 'read');
    const s = sb();
    const { page, pageSize } = getPaginationParams(req.url);

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await s.from('cost_centers')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .order('code')
      .range(offset, offset + pageSize - 1);

    if (err) throw err;
    return success({ cost_centers: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'cost_centers', 'create');
    const s = sb();
    const body = await parseBody(req);
    const { code, name, description, parent_id } = body;

    if (!code || !name) return error('الكود والاسم مطلوبان');

    // عزل مستأجرين: المركز الأب (إن وُجد) يجب أن ينتمي لنفس الشركة
    if (parent_id) {
      const { data: parent } = await s.from('cost_centers')
        .select('id').eq('id', parent_id).eq('company_id', auth.companyId).maybeSingle();
      if (!parent) return error('المركز الأب غير موجود', 404);
    }

    const { data, error: err } = await s.from('cost_centers')
      .insert({
        company_id: auth.companyId,
        code: String(code).toUpperCase(),
        name,
        description: description || null,
        parent_id: parent_id || null,
      })
      .select()
      .single();

    if (err) throw err;

    // Audit log
    await logAudit({
      company_id: auth.companyId,
      user_id: auth.userId,
      entity_type: 'cost_center',
      entity_id: String(data?.id ?? ''),
      action: 'create',
      after: data as Record<string, unknown>,
      summary: 'create_cost_center',
    });

    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
