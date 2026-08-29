import { NextRequest } from 'next/server';
import { success, error, parseBody, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { sendAdminNotification, escapeTelegramHtml } from '@/lib/telegram';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

type AddonType = 'extra_user' | 'extra_branch' | 'storage_gb';
const VALID_TYPES: AddonType[] = ['extra_user', 'extra_branch', 'storage_gb'];

export async function GET(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    // Allow expired users to view their requests (they need to buy).
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    const s = sb();
    const { data, error: err } = await s.from('addon_requests')
      .select('id, addon_type, quantity, duration_type, unit_price_usd, total_amount_usd, payment_method_code, payment_amount, payment_date, payment_time, receipt_image_url, notes, status, admin_notes, reviewed_at, created_at, updated_at')
      .eq('company_id', auth.companyId)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (err) throw err;
    return success({ requests: data || [] });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    // Even expired companies must be able to buy add-ons/upgrades.
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    const body = await parseBody<{
      addon_type?: string;
      quantity?: number;
      duration_type?: 'monthly' | 'yearly';
      payment_method_code?: string;
      payment_date?: string;
      payment_time?: string;
      receipt_image_url?: string;
      notes?: string;
    }>(req);

    const addon_type = (body.addon_type || '') as AddonType;
    const quantity = Number(body.quantity);
    const duration_type = body.duration_type;

    if (!VALID_TYPES.includes(addon_type)) return error('نوع الإضافة غير صالح');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) return error('الكمية بين 1 و100');
    if (duration_type !== 'monthly' && duration_type !== 'yearly') return error('نوع المدة غير صالح');
    if (typeof body.payment_method_code !== 'string' || !/^[a-z0-9_-]{1,50}$/i.test(body.payment_method_code)) return error('طريقة الدفع مطلوبة وغير صالحة');
    // Receipt images are no longer accepted: the screenshot goes to the
    // developer on Telegram (see the instructions inside the request window).
    if (body.receipt_image_url !== undefined && body.receipt_image_url !== null && body.receipt_image_url !== '') {
      return error('لم نعد نقبل رفع صور الإيصالات. أرسل صورة الإيصال عبر تليجرام من نافذة الطلب.', 400);
    }
    if (!body.payment_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.payment_date) || Number.isNaN(Date.parse(body.payment_date))) return error('تاريخ الدفع مطلوب وغير صالح');
    if (body.payment_time !== undefined && body.payment_time !== '' && (typeof body.payment_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(body.payment_time))) return error('وقت الدفع غير صالح');
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) return error('الملاحظات غير صالحة');

    // Pricing, active payment method, duplicate-pending protection, request,
    // admin message and tenant audit are enforced in one tenant-aware RPC.
    const { data: inserted, error: createError } = await sb().rpc('create_addon_request_atomic', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_addon_type: addon_type,
      p_quantity: quantity,
      p_duration_type: duration_type,
      p_payment_method_code: body.payment_method_code,
      p_payment_date: body.payment_date,
      p_payment_time: body.payment_time || null,
      p_receipt_image_url: null,
      p_notes: typeof body.notes === 'string' ? body.notes.trim() : null,
    });
    if (createError?.code === '23505') return error('يوجد طلب إضافة من نفس النوع معلق بالفعل', 409);
    if (createError) throw createError;

    await notifyAdminOfAddonRequest(auth.companyId, auth.userId, inserted as Row | null, {
      addon_type, quantity, duration_type,
      payment_method_code: body.payment_method_code,
      payment_date: body.payment_date,
      payment_time: typeof body.payment_time === 'string' ? body.payment_time : null,
      notes: typeof body.notes === 'string' ? body.notes.trim() : null,
    });

    return success({ request: inserted, total_amount_usd: (inserted as Row)?.total_amount_usd, message: 'تم إرسال طلب الإضافة. أرسل صورة الإيصال عبر تليجرام وسيتم التفعيل بعد المراجعة' }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE ?id=… — the owner withdraws their own still-pending addon request. */
export async function DELETE(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    const id = req.nextUrl.searchParams.get('id') || '';
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID.test(id)) return error('id غير صالح');

    const { data, error: cancelError } = await sb().rpc('cancel_own_subscription_request', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_request_id: id,
      p_kind: 'addon',
    });
    if (cancelError) {
      const message = String(cancelError.message || '');
      if (/not found/i.test(message)) return error('الطلب غير موجود أو تمت مراجعته مسبقاً', 404);
      throw cancelError;
    }
    return success({ request: data, message: 'تم إلغاء الطلب' });
  } catch (e) {
    return handleApiError(e);
  }
}

async function notifyAdminOfAddonRequest(
  companyId: string,
  userId: string,
  created: Row | null,
  details: {
    addon_type: string; quantity: number; duration_type: string;
    payment_method_code: string; payment_date: string; payment_time: string | null; notes: string | null;
  },
): Promise<void> {
  try {
    const s = sb();
    const [companyRes, subRes] = await Promise.all([
      s.from('companies').select('name, email, phone').eq('id', companyId).maybeSingle(),
      s.from('subscriptions').select('subscriber_number, plan_code').eq('company_id', companyId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const company = (companyRes.data || {}) as Row;
    const sub = (subRes.data || {}) as Row;
    const total = (created as Row | null)?.total_amount_usd;
    const addonLabel = details.addon_type === 'extra_user' ? 'مستخدم إضافي'
      : details.addon_type === 'extra_branch' ? 'فرع/مستودع إضافي' : 'تخزين (جيجا)';
    const lines = [
      '🔔 <b>طلب إضافة جديد</b>',
      `🏢 الشركة: ${escapeTelegramHtml(String(company.name || '—'))}`,
      `#️⃣ رقم المشترك: <code>${escapeTelegramHtml(String(sub.subscriber_number || '—'))}</code>`,
      `➕ الإضافة: ${addonLabel} ×${details.quantity} (${details.duration_type === 'yearly' ? 'سنوي' : 'شهري'})`,
      `💵 المبلغ: ${total != null ? String(total) : '—'} USD`,
      `💳 طريقة الدفع: ${escapeTelegramHtml(details.payment_method_code)}`,
      `📅 تاريخ التحويل: ${details.payment_date}${details.payment_time ? ` ${details.payment_time}` : ''}`,
      `🧾 الإيصال: يُرسله العميل على تليجرام`,
    ];
    if (details.notes) lines.push(`📝 ملاحظات: ${escapeTelegramHtml(details.notes.slice(0, 300))}`);
    await sendAdminNotification(lines.join('\n'));
  } catch (e) {
    console.warn('[addon-request] admin notification failed:', e);
  }
}
