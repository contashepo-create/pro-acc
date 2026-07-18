import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * POST /api/telegram/webhook
 * واجهة استقبال نداءات تليجرام التفاعلية الرسمية (Telegram Webhook API Receiver)
 * يدعم الاستدعاءات العامة التفاعلية والتحقق من صحتها وتحديث قواعد البيانات لحظياً
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[Telegram Webhook Payload Received]:', JSON.stringify(body, null, 2));

    // 1. التحقق من وجود نقرة تفاعلية (Callback Query)
    if (!body.callback_query) {
      return NextResponse.json({ success: true, message: 'Not a callback query' }, { status: 200 });
    }

    const s = sb();
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const callbackQuery = body.callback_query;
    const callbackData = callbackQuery.data || '';
    const callbackQueryId = callbackQuery.id;
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;

    // تقسيم البيانات المشفرة المستخرجة من الزر
    // التنسيق المتوقع للـ test run: "test:accept:UUID" أو "test:reject:UUID"
    const parts = callbackData.split(':');
    
    if (parts[0] === 'test' && parts.length === 3) {
      const action = parts[1]; // accept أو reject
      const testRunId = parts[2]; // UUID

      const statusValue = action === 'accept' ? 'accepted' : 'rejected';

      // تحديث حالة الفحص في قاعدة البيانات علائقيًا في السوبابيز
      const { error: updateErr } = await s.from('telegram_test_runs')
        .update({
          status: statusValue,
          updated_at: new Date().toISOString()
        })
        .eq('id', testRunId);

      if (updateErr) {
        console.error('Failed to update telegram test run status:', updateErr);
        // التبليغ بفشل العملية للمستخدم على التليجرام
        await answerCallback(callbackQueryId, 'حدث خطأ في الخادم أثناء تحديث حالة الفحص', true);
        return NextResponse.json({ success: true }, { status: 200 });
      }

      // 2. تأكيد الاستلام لتليجرام لإيقاف مؤشر الانتظار (Stop Spinner)
      const feedbackMsg = action === 'accept' ? 'تم القبول بنجاح! ✅' : 'تم الرفض بنجاح! ❌';
      await answerCallback(callbackQueryId, feedbackMsg);

      // 3. تعديل نص الرسالة في تليجرام لإظهار النتيجة النهائية للمشرف
      if (botToken) {
        const finalStatusText = action === 'accept' 
          ? '🟢 *تم تأكيد فحص الربط التفاعلي بنجاح\\!*\n\nالحالة المعتمدة: *مقبول (موافق) ✅*'
          : '🔴 *تم تأكيد فحص الربط التفاعلي بنجاح\\!*\n\nالحالة المعتمدة: *مرفوض (تم الرفض) ❌*';

        await editTelegramMessage(botToken, chatId, messageId, finalStatusText);
      }

    } else if (parts[0] === 'approve' && parts.length === 3) {
      // ميزة الاعتمادات المحاسبية المستقبلية (Future-proof)
      const action = parts[1]; // approve, reject
      const orderId = parts[2]; // UUID

      await answerCallback(callbackQueryId, `ميزة الاعتماد قيد التطوير: ${action} للطلب ${orderId}`);
    }

    return NextResponse.json({ success: true }, { status: 200 });

  } catch (err) {
    console.error('[Telegram Webhook Error]:', err);
    // تليجرام يتطلب دائماً استجابة 200 لتفادي إعادة إرسال نداءات الويب المتكررة
    return NextResponse.json({ success: false, error: 'Internal logic error' }, { status: 200 });
  }
}

/**
 * إبلاغ خوادم تليجرام بإلغاء مؤشر التحميل على العميل
 */
async function answerCallback(callbackQueryId: string, text: string, showAlert = false) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: showAlert
      })
    });
  } catch (e) {
    console.error('Failed to answer Telegram callback query:', e);
  }
}

/**
 * تعديل رسالة تليجرام القائمة لإبراز النتيجة المحدثة
 */
async function editTelegramMessage(botToken: string, chatId: any, messageId: any, newText: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: 'MarkdownV2'
      })
    });
  } catch (e) {
    console.error('Failed to edit Telegram message:', e);
  }
}
