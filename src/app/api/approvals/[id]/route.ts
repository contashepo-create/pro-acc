import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/** Approve or reject a tenant-owned approval request exactly once. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireModulePermission(request, 'approvals', 'approve');
    const { id } = await params;
    if (!/^[0-9a-fA-F-]{8,}$/.test(id)) return error('معرّف طلب الاعتماد غير صالح');
    const { action, comments } = await parseBody<{ action?: 'approve' | 'reject'; comments?: string }>(request);
    if (!action || !['approve', 'reject'].includes(action) || (comments !== undefined && (typeof comments !== 'string' || comments.length > 2000))) {
      return error('بيانات الاعتماد غير صالحة');
    }

    const s = sb();
    const { data: approvalReq, error: fetchError } = await s.from('approval_requests')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (fetchError || !approvalReq) return error('طلب الاعتماد غير موجود', 404);
    const req = approvalReq as any;
    if (req.approver_id !== auth.userId && auth.role !== 'admin') {
      return error('لست المخول بالاعتماد على هذا الطلب', 403);
    }

    const voucherApprovalType = req.entity_type || req.transaction_type;
    if (voucherApprovalType === 'voucher_disbursement' || voucherApprovalType === 'voucher_receipt') {
      const rpcName = voucherApprovalType === 'voucher_disbursement'
        ? 'respond_voucher_disbursement_approval'
        : 'respond_voucher_receipt_approval';
      const { data, error: decisionErr } = await s.rpc(rpcName, {
        p_company_id: auth.companyId,
        p_approval_id: id,
        p_action: action,
        p_approver_user_id: auth.userId,
        p_approver_chat_id: null,
        p_comments: comments?.trim() || '',
      });
      if (decisionErr) {
        const message = String(decisionErr.message || 'فشل تنفيذ قرار الاعتماد');
        if (message.includes('مخول')) return error(message, 403);
        return error(message, 409);
      }
      return success(data);
    }

    const { data, error: decisionError } = await s.rpc('respond_approval_request_atomic', {
      p_company_id: auth.companyId,
      p_approval_id: id,
      p_action: action,
      p_approver_user_id: auth.userId,
      p_comments: comments?.trim() || '',
    });
    if (decisionError) {
      const message = String(decisionError.message || 'فشل تنفيذ قرار الاعتماد');
      if (/مخول|لا ينتمي للشركة/.test(message)) return error(message, 403);
      if (/غير موجود/.test(message)) return error(message, 404);
      return error(message, 409);
    }
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}
