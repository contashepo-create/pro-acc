import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid, projectUpdateSchema } from '@/lib/project-delivery-validation';

import type { Row } from '@/lib/types';

const PROJECT_COLUMNS = `id,name,client_id,contract_value,start_date,end_date,status,description,location,budget,
  tax_enabled,tax_rate,closed_at,closed_by,closure_journal_entry_id,created_at,updated_at,contacts(name)`;

async function findProject(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('projects').select(PROJECT_COLUMNS)
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المشروع غير صالح');
    const project = await findProject(auth.companyId, id);
    if (!project) return notFound();
    const { data: boq, error: boqError } = await getSupabase().from('boq_items')
      .select('id,project_id,item_code,code,description,unit,quantity,unit_price,total,parent_id,level,created_at')
      .eq('project_id', id).eq('company_id', auth.companyId).order('item_code');
    if (boqError) throw boqError;
    const row = project as Row;
    return success({ ...row, client_id: String(row.client_id || ''), client_name: row.contacts ? String((row.contacts as Row).name) || null : null, contacts: undefined, boq_items: boq || [] });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'update');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المشروع غير صالح');
    const raw = await parseBody<Record<string, unknown>>(request);
    const parsed = projectUpdateSchema.safeParse({
      ...raw,
      ...(raw.client_id !== undefined ? { client_id: raw.client_id || null } : {}),
      ...(raw.end_date !== undefined ? { end_date: raw.end_date || null } : {}),
    });
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات المشروع غير صالحة');
    if (!await findProject(auth.companyId, id)) return notFound();
    const { items, auto_invoice: _autoInvoice, ...payload } = parsed.data;
    const normalizedItems = items?.map(({ total: _total, ...item }) => item) ?? null;
    const { data, error: rpcError } = await getSupabase().rpc('update_project_atomic', {
      p_company_id: auth.companyId, p_project_id: id, p_payload: payload,
      p_items: normalizedItems, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'delete');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المشروع غير صالح');
    if (!await findProject(auth.companyId, id)) return notFound();
    const { data, error: rpcError } = await getSupabase().rpc('cancel_empty_project_atomic', {
      p_company_id: auth.companyId, p_project_id: id, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
