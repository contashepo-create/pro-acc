import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { contractCreateSchema, contractStatus, relationshipUuid } from '@/lib/relationship-validation';

const sb = () => getSupabase();

/** GET /api/contracts — tenant-scoped contract list. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('project_id');
    const status = url.searchParams.get('status');
    if (projectId && !relationshipUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');
    if (status && !contractStatus.safeParse(status).success) return error('حالة العقد غير صالحة');

    let query = sb().from('contracts').select('*, projects(name), contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);
    if (status) query = query.eq('status', status);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('start_date', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const now = Date.now();
    const contracts = (data || []).map((contract: Record<string, unknown>) => {
      const project = contract.projects as { name?: string } | null;
      const contact = contract.contacts as { name?: string } | null;
      return {
        ...contract,
        project_name: project?.name || null,
        contact_name: contact?.name || null,
        isExpiringSoon: !!contract.end_date && new Date(String(contract.end_date)).getTime() >= now
          && new Date(String(contract.end_date)).getTime() - now < 30 * 86400000,
        isExpired: !!contract.end_date && new Date(String(contract.end_date)).getTime() < now,
      };
    });
    return success({ contracts, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/contracts — atomic contract creation and audit. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'create');
    const parsed = contractCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_contract_atomic', {
      p_company_id: auth.companyId,
      p_payload: parsed.data,
      p_user_id: auth.userId,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (message.includes('غير صالحة')) return error(message);
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
