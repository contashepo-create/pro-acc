import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

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

    const now = new Date().toISOString();
    if (action === 'reject') {
      const { data: rejected, error: rejectError } = await s.from('approval_requests')
        .update({
          status: 'rejected', approved_by: auth.userId, approved_at: now,
          approval_comments: comments?.trim() || null, updated_at: now,
        })
        .eq('id', id).eq('company_id', auth.companyId).eq('status', 'pending')
        .select('id').maybeSingle();
      if (rejectError) throw rejectError;
      if (!rejected) return error('تمت معالجة طلب الاعتماد مسبقاً', 409);
      await completeApprovalSideEffects(s, auth, req, id, 'reject', comments, now);
      return success({ id, status: 'rejected', approved_by: auth.userId, approved_at: now });
    }

    // Claim pending -> processing with a compare-and-set. A concurrent caller
    // cannot also claim it. A retry by the same approver may resume a previous
    // processing row after an interrupted request.
    if (req.status === 'pending') {
      const { data: claimed, error: claimError } = await s.from('approval_requests')
        .update({
          status: 'processing', approved_by: auth.userId,
          approval_comments: comments?.trim() || null, updated_at: now,
        })
        .eq('id', id).eq('company_id', auth.companyId).eq('status', 'pending')
        .select('id').maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return error('تمت معالجة طلب الاعتماد مسبقاً', 409);
    } else if (req.status !== 'processing' || req.approved_by !== auth.userId) {
      return error('تمت معالجة طلب الاعتماد مسبقاً', 409);
    }

    try {
      await executeApprovedEntity(s, auth, req.entity_type, req.entity_id);
    } catch (executionError) {
      // Return to a retryable state. The compare predicates prevent this
      // request from overwriting another final decision.
      await s.from('approval_requests')
        .update({ status: 'pending', approved_by: null, approved_at: null, updated_at: new Date().toISOString() })
        .eq('id', id).eq('company_id', auth.companyId)
        .eq('status', 'processing').eq('approved_by', auth.userId);
      console.error('Failed to execute approved entity:', executionError);
      return error('فشل تنفيذ الإجراء بعد الاعتماد', 409);
    }

    const completedAt = new Date().toISOString();
    const { data: finalized, error: finalizeError } = await s.from('approval_requests')
      .update({ status: 'approved', approved_at: completedAt, updated_at: completedAt })
      .eq('id', id).eq('company_id', auth.companyId)
      .eq('status', 'processing').eq('approved_by', auth.userId)
      .select('id').maybeSingle();
    if (finalizeError) throw finalizeError;
    if (!finalized) return error('تعذر تثبيت نتيجة الاعتماد', 409);

    await completeApprovalSideEffects(s, auth, req, id, 'approve', comments, completedAt);
    return success({ id, status: 'approved', approved_by: auth.userId, approved_at: completedAt });
  } catch (err) {
    return handleApiError(err);
  }
}

async function executeApprovedEntity(
  s: any,
  auth: { companyId: string; userId: string; role: string },
  entityType: string,
  entityId: string,
) {
  const source: Record<string, { table: string; patch: Record<string, unknown> }> = {
    journal_entry: { table: 'journal_entries', patch: { status: 'posted' } },
    voucher_disbursement: { table: 'voucher_disbursements', patch: { status: 'approved' } },
    voucher_receipt: { table: 'voucher_receipts', patch: { status: 'approved' } },
    purchase_invoice: { table: 'purchase_invoices', patch: { status: 'approved' } },
    payroll: { table: 'salary_sheets', patch: { status: 'approved' } },
    cash_transaction: { table: 'cash_transactions', patch: { status: 'approved' } },
  };
  const config = source[entityType];
  if (!config) throw new Error('نوع العنصر غير مدعوم للاعتماد');

  const { data, error: updateError } = await s.from(config.table)
    .update({ ...config.patch, approved_by: auth.userId, approved_at: new Date().toISOString() })
    .eq('id', entityId).eq('company_id', auth.companyId)
    .select('id').maybeSingle();
  if (updateError || !data) throw updateError || new Error('العنصر المطلوب اعتماده غير موجود');
}

async function completeApprovalSideEffects(
  s: any,
  auth: { companyId: string; userId: string },
  req: any,
  approvalId: string,
  action: 'approve' | 'reject',
  comments: string | undefined,
  now: string,
) {
  const label = getEntityTypeName(req.entity_type);
  try {
    await s.from('notifications').insert({
      id: generateId(), company_id: auth.companyId, user_id: req.requester_id,
      type: 'approval_response',
      title: action === 'approve' ? 'تم اعتماد طلبك' : 'تم رفض طلبك',
      message: `${label} — ${comments || (action === 'approve' ? 'تم الاعتماد بنجاح' : 'تم الرفض')}`.slice(0, 1000),
      entity_type: 'approval_request', entity_id: approvalId, created_at: now,
    });
  } catch { /* notification is non-authoritative */ }

  await s.from('audit_log').insert({
    id: generateId(), company_id: auth.companyId, user_id: auth.userId,
    action: `${action}_approval`, entity_type: 'approval_request', entity_id: approvalId,
    old_values: { status: action === 'approve' ? 'processing' : 'pending' },
    new_values: { status: action === 'approve' ? 'approved' : 'rejected', entity_type: req.entity_type, entity_id: req.entity_id, comments },
  });
}

function getEntityTypeName(type: string): string {
  const names: Record<string, string> = {
    journal_entry: 'قيد يومية', voucher_disbursement: 'سند صرف',
    voucher_receipt: 'سند قبض', purchase_invoice: 'فاتورة شراء',
    payroll: 'رواتب', cash_transaction: 'سند صندوق',
  };
  return names[type] || type;
}
