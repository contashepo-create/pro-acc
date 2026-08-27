import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { approvalDecisionSchema, communicationUuid } from '@/lib/communication-validation';

const APPROVAL_COLUMNS = `id,entity_type,entity_id,transaction_type,transaction_id,amount,description,message,status,
  requester_id,approver_id,approved_by,approver_chat_id,approved_at,approval_comments,created_at,updated_at,
  requester:users!requester_id(id,name),approver:users!approver_id(id,name)`;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'approvals', 'read');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف طلب الاعتماد غير صالح');
    let query = getSupabase().from('approval_requests').select(APPROVAL_COLUMNS).eq('id', id).eq('company_id', auth.companyId);
    if (auth.role !== 'admin') query = query.eq('approver_id', auth.userId);
    const { data, error: queryError } = await query.single();
    if (queryError || !data) return error('طلب الموافقة غير موجود', 404);
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

async function decideApproval(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'approvals', 'approve');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف طلب الاعتماد غير صالح');
    const parsed = approvalDecisionSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات قرار الاعتماد غير صالحة');
    const supabase = getSupabase();
    const { data: approval, error: fetchError } = await supabase.from('approval_requests')
      .select('id,entity_type,transaction_type,status,approver_id').eq('id', id).eq('company_id', auth.companyId).single();
    if (fetchError || !approval) return error('طلب الموافقة غير موجود', 404);
    if (auth.role !== 'admin' && approval.approver_id !== auth.userId) return error('ليس لديك صلاحية لاتخاذ قرار على هذا الطلب', 403);
    if (!['pending', 'processing'].includes(String(approval.status))) {
      const requestedStatus = parsed.data.action === 'approve' ? 'approved' : 'rejected';
      if (approval.status === requestedStatus) return success({ id, status: approval.status, replayed: true });
      return error('تم اتخاذ قرار مختلف على هذا الطلب مسبقاً', 409);
    }
    const entityType = approval.entity_type || approval.transaction_type;
    const isVoucher = entityType === 'voucher_disbursement' || entityType === 'voucher_receipt';
    const rpcName = entityType === 'voucher_disbursement' ? 'respond_voucher_disbursement_approval'
      : entityType === 'voucher_receipt' ? 'respond_voucher_receipt_approval' : 'respond_approval_request_atomic';
    const rpcParams = isVoucher ? {
      p_company_id: auth.companyId, p_approval_id: id, p_action: parsed.data.action,
      p_approver_user_id: auth.userId, p_approver_chat_id: null, p_comments: parsed.data.comments || '',
    } : {
      p_company_id: auth.companyId, p_approval_id: id, p_action: parsed.data.action,
      p_approver_user_id: auth.userId, p_comments: parsed.data.comments || '',
    };
    const { data, error: rpcError } = await supabase.rpc(rpcName, rpcParams);
    if (rpcError) {
      const message = String(rpcError.message || 'تعذر معالجة طلب الموافقة');
      if (/مسبق|قيد المعالجة|غير صالح/.test(message)) return error(message, 409);
      if (/صلاحية|مخول/.test(message)) return error(message, 403);
      if (/غير موجود/.test(message)) return error(message, 404);
      throw rpcError;
    }
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export const PUT = decideApproval;
export const POST = decideApproval;
