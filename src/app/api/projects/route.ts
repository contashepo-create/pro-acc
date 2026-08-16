import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { projectCreateSchema } from '@/lib/project-delivery-validation';

const PROJECT_COLUMNS = `id,name,client_id,contract_value,start_date,end_date,status,description,location,
  budget,tax_enabled,tax_rate,closed_at,closed_by,closure_journal_entry_id,created_at,updated_at,contacts(name)`;
const BOQ_COLUMNS = 'id,project_id,item_code,code,description,unit,quantity,unit_price,total,parent_id,level,created_at';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');
    if (status && !['active', 'on_hold', 'completed', 'cancelled'].includes(status)) return error('حالة المشروع غير صالحة');
    let query = getSupabase().from('projects').select(PROJECT_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const projectIds = (data || []).map((project: any) => project.id);
    const boqByProject: Record<string, any[]> = {};
    if (projectIds.length) {
      const { data: items, error: boqError } = await getSupabase().from('boq_items').select(BOQ_COLUMNS)
        .in('project_id', projectIds).eq('company_id', auth.companyId).order('item_code');
      if (boqError) throw boqError;
      for (const item of items || []) (boqByProject[item.project_id] ||= []).push(item);
    }
    const rows = (data || []).map((project: any) => ({
      ...project, client_name: project.contacts?.name || null, contacts: undefined,
      boq_items: boqByProject[project.id] || [],
    }));
    return success({ rows, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'create');
    const raw = await parseBody<Record<string, unknown>>(request);
    const normalized = {
      ...raw,
      client_id: raw.client_id || null,
      end_date: raw.end_date || null,
    };
    const parsed = projectCreateSchema.safeParse(normalized);
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات المشروع غير صالحة');
    const input = parsed.data;
    const items = input.items || [];
    const contractValue = input.contract_value || items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const normalizedItems = items.map(({ total: _total, ...item }) => item);
    const { data, error: rpcError } = await getSupabase().rpc('create_project_atomic', {
      p_company_id: auth.companyId, p_name: input.name, p_client_id: input.client_id || null,
      p_contract_value: contractValue, p_start_date: input.start_date, p_end_date: input.end_date || null,
      p_status: input.status || 'active', p_description: input.description || '', p_location: input.location || '',
      p_items: normalizedItems, p_auto_invoice: input.auto_invoice || false, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
