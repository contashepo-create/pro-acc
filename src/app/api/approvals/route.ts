import { NextRequest } from 'next/server';
import { success, error, handleApiError, getPaginationParams, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { approvalCreateSchema } from '@/lib/communication-validation';

import type { Row } from '@/lib/types';

const APPROVAL_COLUMNS = `id,entity_type,entity_id,transaction_type,transaction_id,amount,description,message,status,
  requester_id,approver_id,approved_by,approver_chat_id,approved_at,approval_comments,created_at,updated_at,
  requester:users!requester_id(name),approver:users!approver_id(name)`;
const statuses = ['pending', 'processing', 'approved', 'rejected', 'cancelled'];
const entityTypes = ['journal_entry', 'purchase_invoice', 'payroll', 'cash_transaction', 'voucher_disbursement', 'voucher_receipt'];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'approvals', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status') || 'pending';
    const entityType = url.searchParams.get('entity_type');
    if (status !== 'all' && !statuses.includes(status)) return error('حالة طلب الاعتماد غير صالحة');
    if (entityType && !entityTypes.includes(entityType)) return error('نوع طلب الاعتماد غير صالح');
    let query = getSupabase().from('approval_requests').select(APPROVAL_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (status !== 'all') query = status === 'pending' ? query.in('status', ['pending', 'processing']) : query.eq('status', status);
    if (entityType) query = query.eq('entity_type', entityType);
    if (auth.role !== 'admin') query = query.eq('approver_id', auth.userId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const requests = (data || []).map((row: Row) => ({
      ...row, requester_name: row.requester ? String((row.requester as Row).name) || 'Unknown' : 'Unknown', approver_name: row.approver ? String((row.approver as Row).name) || 'Unknown' : 'Unknown',
      requester: undefined, approver: undefined, urgency: calculateUrgency(String(row.created_at), String(row.entity_type || row.transaction_type)),
    }));
    return success({ requests, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'approvals', 'create');
    const parsed = approvalCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات طلب الاعتماد غير صالحة');
    const { data, error: rpcError } = await getSupabase().rpc('create_approval_request_atomic', {
      p_company_id: auth.companyId, p_entity_type: parsed.data.entity_type, p_entity_id: parsed.data.entity_id,
      p_description: parsed.data.description || '', p_requester_id: auth.userId,
    });
    if (rpcError) {
      const message = String(rpcError.message || 'تعذر إنشاء طلب الاعتماد');
      if (/غير موجود/.test(message)) return error(message, 404);
      if (/قائم/.test(message)) return error(message, 409);
      throw rpcError;
    }
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}

function calculateUrgency(createdAt: string, entityType: string): 'low' | 'medium' | 'high' | 'critical' {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  if (entityType === 'payroll') return 'high';
  if (ageHours > 48) return 'critical';
  if (ageHours > 24) return 'high';
  if (ageHours > 12) return 'medium';
  return 'low';
}
