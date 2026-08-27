import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { trustedReceiptReference } from '@/lib/safe-input';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    // Allow expired users to view their prior upgrade requests (read access is
    // always allowed, but explicit skipModuleGuard keeps the path consistent
    // with the POST endpoint which is whitelisted for expired-write access).
    const auth = await requireApiAuth(request, { skipModuleGuard: true });
    const s = sb();

    const { data, error: err } = await s.from('upgrade_requests')
      .select('id, current_plan_id, requested_plan_id, duration_type, status, payment_method_code, payment_amount, payment_date, payment_time, receipt_image_url, receipt_text, notes, admin_notes, reviewed_at, created_at, updated_at, subscription_plans!requested_plan_id(name, price_monthly, price_yearly)')
      .eq('company_id', auth.companyId)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (err) throw err;

    return success({ requests: data || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'subscription', 'create');
    const body = await parseBody<Record<string, unknown>>(request);

    const requestedPlanId = typeof body.requested_plan_id === 'string' ? body.requested_plan_id : '';
    const durationType = body.duration_type;
    const paymentMethod = typeof body.payment_method_code === 'string' ? body.payment_method_code : '';
    const paymentAmount = Number(body.payment_amount);
    const paymentDate = typeof body.payment_date === 'string' ? body.payment_date : '';
    const paymentTime = typeof body.payment_time === 'string' && body.payment_time ? body.payment_time : null;
    const notes = typeof body.notes === 'string' ? body.notes.trim() : null;

    if (!UUID.test(requestedPlanId) || (durationType !== 'monthly' && durationType !== 'yearly') ||
        !/^[a-z0-9_-]{1,50}$/i.test(paymentMethod)) {
      return error('الحقول المطلوبة مفقودة أو غير صالحة: الباقة، المدة، طريقة الدفع');
    }
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0 ||
        Math.abs(paymentAmount * 100 - Math.round(paymentAmount * 100)) > 1e-8) {
      return error('مبلغ الدفع غير صالح');
    }
    if (!paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(paymentDate))) {
      return error('تاريخ الدفع مطلوب وغير صالح');
    }
    if (paymentTime && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(paymentTime)) return error('وقت الدفع غير صالح');
    if (body.notes !== undefined && typeof body.notes !== 'string') return error('الملاحظات غير صالحة');
    if (notes && notes.length > 2000) return error('الملاحظات طويلة جداً');
    const receiptReference = trustedReceiptReference(body.receipt_image_url, auth.companyId);
    if (!receiptReference) return error('يجب رفع إيصال الدفع عبر التخزين الآمن أولاً');

    // Tenant ownership, catalogue price, active payment method, duplicate
    // protection, request, admin message and audit share one transaction.
    const { data, error: createError } = await sb().rpc('create_upgrade_request_atomic', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_requested_plan_id: requestedPlanId,
      p_duration_type: durationType,
      p_payment_method_code: paymentMethod,
      p_payment_amount: paymentAmount,
      p_payment_date: paymentDate,
      p_payment_time: paymentTime,
      p_receipt_image_url: receiptReference,
      p_notes: notes,
    });
    if (createError?.code === '23505') return error('لديك طلب ترقية معلق بالفعل', 409);
    if (createError) throw createError;

    return success({ request: data, message: 'تم إرسال طلب الترقية. سيتم مراجعته من الإدارة قريباً' }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
