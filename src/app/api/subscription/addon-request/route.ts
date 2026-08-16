import { NextRequest } from 'next/server';
import { success, error, parseBody, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { trustedReceiptReference } from '@/lib/safe-input';

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
    const receiptReference = trustedReceiptReference(body.receipt_image_url, auth.companyId);
    if (!receiptReference) return error('يجب رفع إيصال الدفع عبر التخزين الآمن أولاً');
    if (!body.payment_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.payment_date) || Number.isNaN(Date.parse(body.payment_date))) return error('تاريخ الدفع مطلوب وغير صالح');
    if (body.payment_time !== undefined && body.payment_time !== '' && (typeof body.payment_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(body.payment_time))) return error('وقت الدفع غير صالح');
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) return error('الملاحظات طويلة جداً');

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
      p_receipt_image_url: receiptReference,
      p_notes: typeof body.notes === 'string' ? body.notes.trim() : null,
    });
    if (createError?.code === '23505') return error('يوجد طلب إضافة من نفس النوع معلق بالفعل', 409);
    if (createError) throw createError;

    return success({ request: inserted, total_amount_usd: (inserted as any)?.total_amount_usd }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
