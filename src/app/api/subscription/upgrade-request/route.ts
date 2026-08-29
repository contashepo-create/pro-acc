import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, requireModulePermission, handleApiError, success, error, parseBody } from '@/lib/api-helpers';
import { sendAdminNotification, escapeTelegramHtml } from '@/lib/telegram';

import type { Row } from '@/lib/types';

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
    // Receipt images are no longer accepted: the screenshot is sent to the
    // developer on Telegram. Reject any stale reference explicitly so old
    // clients cannot silently reintroduce uploads.
    if (body.receipt_image_url !== undefined && body.receipt_image_url !== null && body.receipt_image_url !== '') {
      return error('لم نعد نقبل رفع صور الإيصالات. أرسل صورة الإيصال عبر تليجرام من نافذة الطلب.', 400);
    }

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
      p_receipt_image_url: null,
      p_notes: notes,
    });
    if (createError?.code === '23505') return error('لديك طلب ترقية معلق بالفعل', 409);
    if (createError) throw createError;

    // Best-effort admin-bot announcement with the subscriber reference so the
    // developer can match the incoming Telegram receipt to this request. It
    // has a bounded delivery window and never fails the request when Telegram
    // is unreachable.
    await notifyAdminOfUpgradeRequest(auth.companyId, auth.userId, data as Row | null, {
      plan_id: requestedPlanId,
      duration_type: String(durationType),
      payment_method_code: paymentMethod,
      payment_amount: paymentAmount,
      payment_date: paymentDate,
      payment_time: paymentTime,
      notes,
    });

    return success({ request: data, message: 'تم إرسال طلب الترقية. أرسل صورة الإيصال عبر تليجرام وسيتم المراجعة قريباً' }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE ?id=… — the owner withdraws their own still-pending request. */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request, { skipModuleGuard: true });
    const id = request.nextUrl.searchParams.get('id') || '';
    if (!UUID.test(id)) return error('id غير صالح');

    const { data, error: cancelError } = await sb().rpc('cancel_own_subscription_request', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_request_id: id,
      p_kind: 'upgrade',
    });
    if (cancelError) {
      const message = String(cancelError.message || '');
      if (/not found/i.test(message)) return error('الطلب غير موجود أو تمت مراجعته مسبقاً', 404);
      throw cancelError;
    }
    return success({ request: data, message: 'تم إلغاء الطلب' });
  } catch (err) {
    return handleApiError(err);
  }
}

async function notifyAdminOfUpgradeRequest(
  companyId: string,
  userId: string,
  created: Row | null,
  details: {
    plan_id: string; duration_type: string; payment_method_code: string;
    payment_amount: number; payment_date: string; payment_time: string | null; notes: string | null;
  },
): Promise<void> {
  try {
    const s = sb();
    const [companyRes, subRes, planRes] = await Promise.all([
      s.from('companies').select('name, email, phone').eq('id', companyId).maybeSingle(),
      s.from('subscriptions').select('subscriber_number, plan_code').eq('company_id', companyId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      s.from('subscription_plans').select('name, currency').eq('id', details.plan_id).maybeSingle(),
    ]);
    const company = (companyRes.data || {}) as Row;
    const sub = (subRes.data || {}) as Row;
    const plan = (planRes.data || {}) as Row;
    const lines = [
      '🔔 <b>طلب ترقية/تجديد جديد</b>',
      `🏢 الشركة: ${escapeTelegramHtml(String(company.name || '—'))}`,
      `#️⃣ رقم المشترك: <code>${escapeTelegramHtml(String(sub.subscriber_number || '—'))}</code>`,
      `📦 الباقة المطلوبة: ${escapeTelegramHtml(String(plan.name || '—'))} (${details.duration_type === 'yearly' ? 'سنوي' : 'شهري'})`,
      `💵 المبلغ: ${details.payment_amount} ${escapeTelegramHtml(String(plan.currency || 'USD'))}`,
      `💳 طريقة الدفع: ${escapeTelegramHtml(details.payment_method_code)}`,
      `📅 تاريخ التحويل: ${details.payment_date}${details.payment_time ? ` ${details.payment_time}` : ''}`,
      `🧾 الإيصال: يُرسله العميل على تليجرام`,
    ];
    if (details.notes) lines.push(`📝 ملاحظات: ${escapeTelegramHtml(details.notes.slice(0, 300))}`);
    await sendAdminNotification(lines.join('\n'));
  } catch (e) {
    console.warn('[upgrade-request] admin notification failed:', e);
  }
}
