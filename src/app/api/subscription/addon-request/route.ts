import { NextRequest } from 'next/server';
import { success, error, parseBody, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

const ADDON_PRICING = {
  extra_user:   { monthly: 5,  yearly: 48,  label_ar: 'مستخدم إضافي' },
  extra_branch: { monthly: 10, yearly: 96,  label_ar: 'فرع/مستودع إضافي' },
  storage_gb:   { monthly: 3,  yearly: 30,  label_ar: '1 جيجا تخزين إضافي' },
} as const;

type AddonType = keyof typeof ADDON_PRICING;
const VALID_TYPES: AddonType[] = ['extra_user', 'extra_branch', 'storage_gb'];

export async function GET(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    // Allow expired users to view their requests (they need to buy).
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    const s = sb();
    const { data, error: err } = await s.from('addon_requests')
      .select('*')
      .eq('company_id', auth.companyId)
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
      payment_amount?: number;
      payment_date?: string;
      payment_time?: string;
      receipt_image_url?: string;
      notes?: string;
    }>(req);

    const addon_type = (body.addon_type || '') as AddonType;
    const quantity = Number(body.quantity);
    const duration_type = body.duration_type;

    if (!VALID_TYPES.includes(addon_type)) return error('نوع الإضافة غير صالح');
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100) return error('الكمية بين 1 و100');
    if (duration_type !== 'monthly' && duration_type !== 'yearly') return error('نوع المدة غير صالح');
    if (!body.payment_method_code) return error('طريقة الدفع مطلوبة');

    const unit = ADDON_PRICING[addon_type];
    const unitPrice = duration_type === 'monthly' ? unit.monthly : unit.yearly;
    const total = Number((unitPrice * quantity).toFixed(2));

    // Prevent duplicate pending requests of same type
    const s = sb();
    const { data: existing } = await s.from('addon_requests')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('addon_type', addon_type)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();
    if (existing) return error('يوجد طلب إضافة من نفس النوع معلق بالفعل. انتظر المراجعة.', 409);

    const { data: inserted, error: insErr } = await s.from('addon_requests')
      .insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        addon_type,
        quantity,
        duration_type,
        unit_price_usd: unitPrice,
        total_amount_usd: total,
        payment_method_code: body.payment_method_code,
        payment_amount: body.payment_amount ?? total,
        payment_date: body.payment_date || new Date().toISOString().split('T')[0],
        payment_time: body.payment_time || null,
        receipt_image_url: body.receipt_image_url || null,
        notes: body.notes || null,
        status: 'pending',
      })
      .select('id')
      .single();
    if (insErr) throw insErr;

    // Notify admin
    try {
      await s.from('company_messages').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        subject: `طلب إضافة: ${unit.label_ar} ×${quantity}`,
        body: `طلب شراء إضافة جديد:\nالنوع: ${addon_type}\nالكمية: ${quantity}\nالمدة: ${duration_type === 'monthly' ? 'شهري' : 'سنوي'}\nالمبلغ: $${total}\nطريقة الدفع: ${body.payment_method_code}\nملاحظات: ${body.notes || ''}`,
        type: 'addon_request',
        status: 'open',
      });
    } catch {}

    return success({ request: inserted, total_amount_usd: total }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
