import {NextRequest} from 'next/server';
import {success, getPaginationParams, handleApiError, requireModulePermission} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/financial-audit — the company's financial audit trail.
 * Query params: entity_type, entity_id, action.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const entityType = url.searchParams.get('entity_type');
    const entityId = url.searchParams.get('entity_id');
    const action = url.searchParams.get('action');

    let q = s.from('financial_audit_trails')
      .select('*, users(name, email)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (entityType) q = q.eq('entity_type', entityType);
    if (entityId) q = q.eq('entity_id', entityId);
    if (action) q = q.eq('action', action);

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await q.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (err) throw err;

    return success({ rows: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}
