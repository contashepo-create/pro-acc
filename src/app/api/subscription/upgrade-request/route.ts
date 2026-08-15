import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { trustedReceiptReference } from '@/lib/safe-input';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    // Allow expired users to view their prior upgrade requests (read access is
    // always allowed, but explicit skipModuleGuard keeps the path consistent
    // with the POST endpoint which is whitelisted for expired-write access).
    const auth = await requireApiAuth(request, { skipModuleGuard: true });
    const s = sb();

    const { data, error: err } = await s.from('upgrade_requests')
      .select('*, subscription_plans!requested_plan_id(name, price_monthly, price_yearly)')
      .eq('company_id', auth.companyId)
      .order('created_at', { ascending: false });

    if (err) throw err;

    return success({ requests: data || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'subscription', 'create');
    const s = sb();
    const body = await parseBody(request);

    const {
      requested_plan_id,
      duration_type,
      payment_method_code,
      payment_amount,
      payment_date,
      payment_time,
      receipt_image_url,
      notes
    } = body;

    if (!requested_plan_id || !['monthly', 'yearly'].includes(duration_type) || !payment_method_code) {
      return error('الحقول المطلوبة مفقودة أو غير صالحة: الباقة، المدة، طريقة الدفع');
    }
    const receiptReference = trustedReceiptReference(receipt_image_url, auth.companyId);
    if (!receiptReference) return error('يجب رفع إيصال الدفع عبر التخزين الآمن أولاً');
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) return error('الملاحظات طويلة جداً');

    // Check current subscription
    const { data: currentSub } = await s.from('subscriptions')
      .select('plan_id')
      .eq('company_id', auth.companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Check if there's already pending request
    const { data: pending } = await s.from('upgrade_requests')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (pending) {
      return error('لديك طلب ترقية معلق بالفعل. يرجى الانتظار حتى تتم مراجعته', 400);
    }

    // Validate plan exists
    const { data: plan } = await s.from('subscription_plans')
      .select('id, code, price_monthly, price_yearly')
      .eq('id', requested_plan_id)
      .eq('is_active', true)
      .single();

    if (!plan) return error('الباقة المطلوبة غير موجودة', 404);
    const expectedAmount = Number(duration_type === 'yearly'
      ? (plan as any).price_yearly
      : (plan as any).price_monthly);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) return error('سعر الباقة غير صالح، تواصل مع الإدارة');
    if (!Number.isFinite(Number(payment_amount)) || Math.abs(Number(payment_amount) - expectedAmount) > 0.01) {
      return error(`مبلغ الدفع يجب أن يطابق سعر الباقة (${expectedAmount.toFixed(2)})`);
    }
    if (!payment_date || !/^\d{4}-\d{2}-\d{2}$/.test(payment_date)) return error('تاريخ الدفع مطلوب وغير صالح');

    // Validate payment method
    const { data: paymentMethod } = await s.from('payment_methods')
      .select('code')
      .eq('code', payment_method_code)
      .eq('is_active', true)
      .single();

    if (!paymentMethod) return error('طريقة الدفع غير صالحة', 400);

    const { data: newRequest, error: insertErr } = await s.from('upgrade_requests')
      .insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        current_plan_id: (currentSub as any)?.plan_id || null,
        requested_plan_id,
        duration_type,
        payment_method_code,
        payment_amount: expectedAmount,
        payment_date,
        payment_time: typeof payment_time === 'string' ? payment_time.slice(0, 16) : null,
        receipt_image_url: receiptReference,
        notes: typeof notes === 'string' ? notes.trim() : null,
        status: 'pending',
      })
      .select()
      .single();

    if (insertErr?.code === '23505') return error('لديك طلب ترقية معلق بالفعل', 409);
    if (insertErr) throw insertErr;

    // Send to Telegram bot if configured
    try {
      console.log(`New upgrade request: ${newRequest.id} from company ${auth.companyId}`);
    } catch {}

    // Create notification for admin
    await s.from('company_messages').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      subject: `طلب ترقية إلى ${(plan as Record<string, any>).code}`,
      body: `طلب ترقية جديد:\nالباقة: ${(plan as Record<string, any>).code}\nالمدة: ${duration_type}\nطريقة الدفع: ${payment_method_code}\nالمبلغ: ${payment_amount}\nالتاريخ: ${payment_date} ${payment_time}\nملاحظات: ${notes || ''}`,
      type: 'upgrade',
      status: 'open',
    });

    return success({ request: newRequest, message: 'تم إرسال طلب الترقية. سيتم مراجعته من الإدارة قريباً' }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
