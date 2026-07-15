import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/approvals
 * List pending/completed approvals for the current user's role
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status') || 'pending';
    const entityType = url.searchParams.get('entity_type');

    let query = s.from('approval_requests')
      .select('*, requester:users!requester_id(name), approver:users!approver_id(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    // If user is not admin, only show requests where they are the approver
    if (auth.role !== 'admin') {
      query = query.eq('approver_id', auth.userId);
    }

    const offset = (page - 1) * pageSize;
    const { data, error: qErr, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    const requests = (data || []).map((r: any) => ({
      ...r,
      requester_name: r.requester?.name || 'Unknown',
      approver_name: r.approver?.name || 'Unknown',
      urgency: calculateUrgency(r.created_at, r.entity_type),
    }));

    return success({
      requests,
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/approvals
 * Create a new approval request
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();
    const { entity_type, entity_id, amount, description } = body;

    if (!entity_type || !entity_id) {
      return error('entity_type و entity_id مطلوبان');
    }

    // Determine the approver based on amount and type
    const approverId = await determineApprover(s, auth, entity_type, amount);
    if (!approverId) {
      return error('لم يتم تحديد معتمد لهذا النوع من الطلبات');
    }

    // Check if there's already a pending request for this entity
    const { data: existing } = await s.from('approval_requests')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return error('يوجد طلب اعتماد قائم لهذا العنصر بالفعل');
    }

    const requestId = generateId();
    const { data: approvalReq, error: insertErr } = await s.from('approval_requests')
      .insert({
        id: requestId,
        company_id: auth.companyId,
        entity_type,
        entity_id,
        amount: amount || null,
        description: description || null,
        requester_id: auth.userId,
        approver_id: approverId,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Create notification for the approver
    try {
      await s.from('notifications').insert({
        id: generateId(),
        company_id: auth.companyId,
        user_id: approverId,
        type: 'approval_request',
        title: 'طلب اعتماد جديد',
        message: `طلب اعتماد ${getEntityTypeName(entity_type)} بمبلغ ${amount || 'غير محدد'} ر.س`,
        entity_type: 'approval_request',
        entity_id: requestId,
        created_at: new Date().toISOString(),
      });
    } catch (notifErr) {
      console.warn('Failed to create notification:', notifErr);
    }

    return success(approvalReq, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Determine the appropriate approver based on entity type and amount
 */
async function determineApprover(
  s: any,
  auth: { companyId: string; userId: string; role: string },
  entityType: string,
  amount?: number
): Promise<string | null> {
  // Define approval rules
  const rules = {
    // Journal entries over 100k need manager approval
    journal_entry: { threshold: 100000, approver_role: 'manager' },
    // Disbursements over 50k need admin approval
    voucher_disbursement: { threshold: 50000, approver_role: 'admin' },
    // Purchase invoices need manager approval
    purchase_invoice: { threshold: 0, approver_role: 'manager' },
    // Payroll needs admin approval
    payroll: { threshold: 0, approver_role: 'admin' },
    // Default: manager
    default: { threshold: 0, approver_role: 'manager' },
  };

  const rule = rules[entityType as keyof typeof rules] || rules.default;
  const targetRole = amount && amount > rule.threshold ? rule.approver_role : 'manager';

  // Find a user with the target role in the same company
  const { data: approver } = await s.from('users')
    .select('id')
    .eq('company_id', auth.companyId)
    .eq('role', targetRole)
    .eq('is_active', true)
    .neq('id', auth.userId) // Can't approve your own request
    .limit(1)
    .maybeSingle();

  // Fallback to admin if no manager found
  if (!approver && targetRole !== 'admin') {
    const { data: admin } = await s.from('users')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('role', 'admin')
      .eq('is_active', true)
      .neq('id', auth.userId)
      .limit(1)
      .maybeSingle();
    return admin?.id || null;
  }

  return approver?.id || null;
}

/**
 * Calculate urgency based on age and type
 */
function calculateUrgency(createdAt: string, entityType: string): 'low' | 'medium' | 'high' | 'critical' {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);

  // Payroll is always high priority
  if (entityType === 'payroll') return 'high';

  // Over 48 hours = critical
  if (ageHours > 48) return 'critical';
  // Over 24 hours = high
  if (ageHours > 24) return 'high';
  // Over 12 hours = medium
  if (ageHours > 12) return 'medium';
  return 'low';
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
