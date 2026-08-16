import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { success, error, handleApiError, requireAdmin, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const resetRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request') }).strict(),
  z.object({ action: z.literal('confirm'), code: z.string().regex(/^\d{6}$/) }).strict(),
]);

async function sendTelegram(chatId: string, payload: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('رمز بوت تيليجرام غير مهيأ في الخادم');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) throw new Error(String(result?.description || 'تعذر إرسال رسالة تيليجرام'));
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const parsed = resetRequestSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'طلب التصفير غير صالح');
    const supabase = getSupabase();
    if (parsed.data.action === 'request') {
      const { data: session, error: rpcError } = await supabase.rpc('start_telegram_reset_session_atomic', {
        p_company_id: auth.companyId, p_user_id: auth.userId,
      });
      if (rpcError) {
        const message = String(rpcError.message || 'تعذر بدء طلب التصفير');
        if (/غير مفعلة|غير موجود/.test(message)) return error(message, 400);
        if (/قائم/.test(message)) return error(message, 409);
        throw rpcError;
      }
      const chatId = (session as { chat_id?: string } | null)?.chat_id;
      if (!chatId) throw new Error('لم يتم العثور على محادثة تيليجرام الموثوقة');
      try {
        await sendTelegram(chatId, {
          text: '🚨 <b>طلب تصفير بيانات الشركة</b>\n\nسيؤدي القبول إلى إصدار رمز لمرة واحدة. لا تشارك الرمز مع أي شخص.',
          reply_markup: { inline_keyboard: [[
            { text: 'الموافقة وإصدار الرمز ✅', callback_data: 'reset:approve' },
            { text: 'رفض الطلب ❌', callback_data: 'reset:reject' },
          ]] },
        });
      } catch (cause) {
        await supabase.rpc('cancel_telegram_reset_session_atomic', {
          p_company_id: auth.companyId, p_requester_id: auth.userId, p_reason: 'telegram_send_failed',
        });
        return error(cause instanceof Error ? cause.message : 'تعذر إرسال طلب التصفير', 502);
      }
      return success({ status: 'pending_approval' }, 201);
    }
    const codeHash = createHash('sha256').update(parsed.data.code).digest('hex');
    const { data, error: rpcError } = await supabase.rpc('reset_company_business_data', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_code_hash: codeHash,
    });
    if (rpcError) {
      const message = String(rpcError.message || 'تعذر تصفير البيانات');
      if (/رمز|منتهي|جلسة|محاولة/.test(message)) return error(message, 400);
      if (/طلب التصفير/.test(message)) return error(message, 403);
      throw rpcError;
    }
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const { data, error: rpcError } = await getSupabase().rpc('cancel_telegram_reset_session_atomic', {
      p_company_id: auth.companyId, p_requester_id: auth.userId, p_reason: 'cancelled_by_requester',
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
