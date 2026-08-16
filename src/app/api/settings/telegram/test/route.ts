import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireAdmin } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { checkModuleAccess } from '@/lib/usage-limits';
import { communicationUuid } from '@/lib/communication-validation';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const testRunId = new URL(request.url).searchParams.get('test_run_id') || '';
    if (!communicationUuid.safeParse(testRunId).success) return error('معرف فحص الربط غير صالح');
    const { data, error: queryError } = await getSupabase().from('telegram_test_runs')
      .select('id,status,updated_at').eq('id', testRunId).eq('company_id', auth.companyId).eq('created_by', auth.userId).maybeSingle();
    if (queryError) throw queryError;
    if (!data) return error('لم يتم العثور على فحص الربط المطلوب', 404);
    return success({ testRunId: data.id, status: data.status, updatedAt: data.updated_at });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!await checkModuleAccess(auth.companyId, 'telegram_integration')) return error('هذه الميزة غير متوفرة في باقتك الحالية', 403);
    const supabase = getSupabase();
    const { data: run, error: startError } = await supabase.rpc('create_telegram_test_run_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId,
    });
    if (startError) {
      const message = String(startError.message || 'تعذر بدء الاختبار');
      if (/غير مفعلة|غير موجود/.test(message)) return error(message, 400);
      if (/قيد التنفيذ/.test(message)) return error(message, 409);
      throw startError;
    }
    const testRunId = (run as { id?: string } | null)?.id;
    const chatId = (run as { chat_id?: string } | null)?.chat_id;
    if (!testRunId || !chatId) throw new Error('استجابة بدء اختبار تيليجرام غير صالحة');
    const token = process.env.TELEGRAM_BOT_TOKEN;
    let sendError = '';
    if (!token) {
      sendError = 'رمز بوت تيليجرام غير مهيأ في الخادم';
    } else {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            chat_id: chatId, parse_mode: 'HTML',
            text: '🧪 <b>طلب فحص الربط التفاعلي</b>\n\nاضغط على أحد الزرين لتأكيد جاهزية الربط.',
            reply_markup: { inline_keyboard: [[
              { text: 'موافق ✅', callback_data: `test:accept:${testRunId}` },
              { text: 'مرفوض ❌', callback_data: `test:reject:${testRunId}` },
            ]] },
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.ok !== true) sendError = String(result?.description || `Telegram HTTP ${response.status}`).slice(0, 500);
      } catch (cause) {
        sendError = cause instanceof Error ? cause.message.slice(0, 500) : 'تعذر الاتصال بتيليجرام';
      }
    }
    if (sendError) {
      await supabase.rpc('expire_telegram_test_run_atomic', {
        p_company_id: auth.companyId, p_test_run_id: testRunId, p_user_id: auth.userId,
      });
      return error(sendError, 502);
    }
    return success({ message: 'تم إرسال رسالة الفحص التفاعلي إلى تيليجرام', testRunId }, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
