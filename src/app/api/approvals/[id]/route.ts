import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * PUT /api/approvals/[id]
 * Approve or reject an approval request
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();
    const { action, comments } = body; // action: 'approve' | 'reject'

    if (!action || !['approve', 'reject'].includes(action)) {
      return error('action يجب أن يكون approve أو reject');
    }

    // Fetch the approval request
    const { data: approvalReq, error: fetchErr } = await s.from('approval_requests')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (fetchErr || !approvalReq) {
      return error('طلب الاعتماد غير موجود', 404);
    }

    const req = approvalReq as any;

    // Verify the current user is the designated approver
    if (req.approver_id !== auth.userId && auth.role !== 'admin') {
      return error('لست المخول بالاعتماد على هذا الطلب', 403);
    }

    // Verify it's still pending
    if (req.status !== 'pending') {
      return error(`هذا الطلب ${req.status === 'approved' ? 'مُعتمد بالفعل' : 'مرفوض بالفعل'}`);
    }

    const now = new Date().toISOString();
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Update the approval request
    const { error: updateErr } = await s.from('approval_requests')
      .update({
        status: newStatus,
        approved_by: auth.userId,
        approved_at: now,
        approval_comments: comments || null,
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    // If approved, execute the entity-specific action
    if (action === 'approve') {
      try {
        await executeApprovedEntity(s, auth, req.entity_type, req.entity_id);
      } catch (execErr) {
        console.error('Failed to execute approved entity:', execErr);
        // Revert approval status
        await s.from('approval_requests')
          .update({ status: 'pending', approved_by: null, approved_at: null })
          .eq('id', id);
        return error('فشل تنفيذ الإجراء بعد الاعتماد');
      }
    }

    // Notify the requester
    try {
      await s.from('notifications').insert({
        id: generateId(),
        company_id: auth.companyId,
        user_id: req.requester_id,
        type: 'approval_response',
        title: action === 'approve' ? 'تم اعتماد طلبك' : 'تم رفض طلبك',
        message: `${getEntityTypeName(req.entity_type)} — ${comments || (action === 'approve' ? 'تم الاعتماد بنجاح' : 'تم الرفض')}`,
        entity_type: 'approval_request',
        entity_id: id,
        created_at: now,
      });
    } catch (notifErr) {
      console.warn('Failed to send notification:', notifErr);
    }

    // Log in audit trail
    try {
      await s.from('audit_log').insert({
        id: generateId(),
        company_id: auth.companyId,
        user_id: auth.userId,
        action: `${action}_approval`,
        entity_type: 'approval_request',
        entity_id: id,
        old_values: { status: 'pending' },
        new_values: { status: newStatus, entity_type: req.entity_type, entity_id: req.entity_id, comments },
      });
    } catch { /* ignore */ }

    return success({
      id,
      status: newStatus,
      approved_by: auth.userId,
      approved_at: now,
      comments: comments || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Execute entity-specific action after approval
 */
async function executeApprovedEntity(
  s: any,
  auth: { companyId: string; userId: string; role: string },
  entityType: string,
  entityId: string
) {
  switch (entityType) {
    case 'journal_entry':
      // Mark journal entry as approved/posted
      await s.from('journal_entries')
        .update({ status: 'posted', approved_by: auth.userId, approved_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('company_id', auth.companyId);
      break;

    case 'voucher_disbursement':
    case 'voucher_receipt':
      // Mark voucher as approved
      const voucherTable = entityType === 'voucher_disbursement' ? 'voucher_disbursements' : 'voucher_receipts';
      await s.from(voucherTable)
        .update({ status: 'approved', approved_by: auth.userId, approved_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('company_id', auth.companyId);
      break;

    case 'purchase_invoice':
      await s.from('purchase_invoices')
        .update({ status: 'approved', approved_by: auth.userId, approved_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('company_id', auth.companyId);
      break;

    case 'payroll':
      await s.from('salary_sheets')
        .update({ status: 'approved', approved_by: auth.userId, approved_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('company_id', auth.companyId);
      break;

    case 'cash_transaction':
      await s.from('cash_transactions')
        .update({ status: 'approved', approved_by: auth.userId, approved_at: new Date().toISOString() })
        .eq('id', entityId)
        .eq('company_id', auth.companyId);
      break;

    default:
      console.warn(`Unknown entity type for approval: ${entityType}`);
  }
}

function getEntityTypeName(type: string): string {
  const names: Record<string, string> = {
    journal_entry: 'قيد يومية',
    voucher_disbursement: 'سند صرف',
    voucher_receipt: 'سند قبض',
    purchase_invoice: 'فاتورة شراء',
    payroll: 'رواتب',
    cash_transaction: 'سند صندوق',
  };
  return names[type] || type;
}
