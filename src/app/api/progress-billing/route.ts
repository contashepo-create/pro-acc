import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryDate, deliveryUuid, progressBillingCreateSchema } from '@/lib/project-delivery-validation';

import type { Row } from '@/lib/types';

const CLAIM_COLUMNS = `id,project_id,claim_number,date,description,gross_amount,retention_rate,retention_amount,
  net_amount,tax_rate,tax_amount,status,is_final,created_at,updated_at,projects(name)`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('project_id');
    const fromDate = url.searchParams.get('from_date');
    const toDate = url.searchParams.get('to_date');
    if (projectId && !deliveryUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');
    if (fromDate && !deliveryDate.safeParse(fromDate).success) return error('تاريخ البداية غير صالح');
    if (toDate && !deliveryDate.safeParse(toDate).success) return error('تاريخ النهاية غير صالح');
    if (fromDate && toDate && fromDate > toDate) return error('نطاق التاريخ غير صالح');
    let query = getSupabase().from('progress_billing').select(CLAIM_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);
    if (fromDate) query = query.gte('date', fromDate);
    if (toDate) query = query.lte('date', toDate);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const claims = (data || []).map((row: Row) => ({
      ...row,
      project_name: row.projects ? String((row.projects as Row).name) || null : null,
      projects: undefined,
      total_amount: Number(row.net_amount || 0) + Number(row.tax_amount || 0),
    }));
    return success({ claims, progressBilling: claims, total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'create');
    const parsed = progressBillingCreateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات المستخلص غير صالحة');
    const input = parsed.data;
    const retentionRate = input.retention_rate ?? ((input.retention_percentage || 0) / 100);
    const taxRate = input.tax_enabled === false ? 0 : (input.tax_rate || 0);
    const { data, error: rpcError } = await getSupabase().rpc('create_progress_billing_atomic', {
      p_company_id: auth.companyId, p_project_id: input.project_id, p_date: input.date,
      p_claim_number: input.claim_number || '', p_description: input.description || input.notes || '',
      p_gross_amount: input.gross_amount, p_retention_rate: retentionRate, p_tax_rate: taxRate,
      p_is_final: input.is_final || false, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
