import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * POST /api/telegram/webhook
 * واجهة استقبال نداءات تليجرام التفاعلية الرسمية (Telegram Webhook API Receiver)
 * يدعم:
 * 1. الرسائل العادية (مثل /start) للترحيب بالمستخدم وإعطائه معرفه الرقمي (Chat ID)
 * 2. الاستدعاءات التفاعلية (Callback Query) المدمجة:
 *    أ. فحص الاتصال التفاعلي (Test Run) المفرز بنقطتين مثل "test:accept:UUID"
 *    ب. الاعتمادات والموافقات المالية الحقيقية المفرزة بشرطة سفلية مثل "approve_approve_TYPE_ID_USER"
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[Telegram Webhook Payload Received]:', JSON.stringify(body, null, 2));

    const s = sb();
    const botToken = process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.startsWith('sk_') 
      ? process.env.TELEGRAM_BOT_TOKEN 
      : '8946794048:AAEoxOAsWWFSNKxpawtwcpvo2nIy0Pf6N9I';

    // 1. التعامل مع الرسائل العادية (مثل كتابة /start)
    if (body.message) {
      const chatId = body.message.chat?.id;
      const text = (body.message.text || '').trim();

      if (chatId && (text.startsWith('/start') || text.toLowerCase() === 'start')) {
        if (!botToken) {
          console.warn('[Telegram Webhook] TELEGRAM_BOT_TOKEN is missing.');
          return NextResponse.json({ success: false, message: 'Server missing bot token' }, { status: 200 });
        }

        const welcomeMessage = `🤖 <b>مرحباً بك في بوت برو أكاونت الموحد للأنظمة المحاسبية!</b>

🔐 معرّف الدردشة الرقمي الخاص بك (Chat ID) هو:
<code>${chatId}</code>

👉 قم بنسخ هذا الرقم (بالضغط المطول عليه للنسخ السريع) وضعه في خانة <b>Chat ID</b> في صفحة إعدادات تيليجرام بالموقع لتفعيل الربط والاعتمادات اللحظية عبر الجوال!`;

        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: welcomeMessage,
            parse_mode: 'HTML',
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('[Telegram Webhook] Failed to send welcome message:', response.status, errText);
        }
      }
      
      return NextResponse.json({ success: true, message: 'Message update processed' }, { status: 200 });
    }

    // 2. التحقق من وجود نقرة تفاعلية (Callback Query) على الأزرار
    if (!body.callback_query) {
      return NextResponse.json({ success: true, message: 'Not a callback query' }, { status: 200 });
    }

    const callbackQuery = body.callback_query;
    const callbackData = callbackQuery.data || '';
    const callbackQueryId = callbackQuery.id;
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;

    // معالجة فحص الاتصال اللحظي التفاعلي (Test Run)
    if (callbackData.startsWith('test:')) {
      const parts = callbackData.split(':');
      if (parts.length === 3) {
        const action = parts[1]; // accept أو reject
        const testRunId = parts[2]; // UUID
        const statusValue = action === 'accept' ? 'accepted' : 'rejected';

        // تحديث قاعدة البيانات
        const { error: updateErr } = await s.from('telegram_test_runs')
          .update({
            status: statusValue,
            updated_at: new Date().toISOString()
          })
          .eq('id', testRunId);

        if (updateErr) {
          console.error('Failed to update telegram test run status:', updateErr);
          await answerCallback(callbackQueryId, 'حدث خطأ في الخادم أثناء تحديث حالة الفحص', true);
          return NextResponse.json({ success: true }, { status: 200 });
        }

        const feedbackMsg = action === 'accept' ? 'تم القبول بنجاح! ✅' : 'تم الرفض بنجاح! ❌';
        await answerCallback(callbackQueryId, feedbackMsg);

        if (botToken) {
          const finalStatusText = action === 'accept' 
            ? '🟢 <b>تم تأكيد فحص الربط التفاعلي بنجاح!</b>\n\nالحالة المعتمدة: <b>مقبول وموافق عليه ✅</b>'
            : '🔴 <b>تم تأكيد فحص الربط التفاعلي بنجاح!</b>\n\nالحالة المعتمدة: <b>تم الرفض والمرفوض ❌</b>';

          await editTelegramMessage(botToken, chatId, messageId, finalStatusText);
        }
      }
    } 
    // معالجة الاعتمادات والموافقات المالية الحقيقية (Real-time Approvals)
    else if (callbackData.startsWith('approve_')) {
      const parts = callbackData.split('_');
      if (parts.length >= 4) {
        const action = parts[1] as 'approve' | 'reject'; // approve أو reject
        const requesterId = parts[parts.length - 1]; // معرف منشئ القيد
        const transactionId = parts[parts.length - 2]; // UUID المعاملة
        const transactionType = parts.slice(2, parts.length - 2).join('_'); // نوع المعاملة

        if (!['approve', 'reject'].includes(action)) {
          await answerCallback(callbackQueryId, 'إجراء غير صالح', true);
          return NextResponse.json({ success: true }, { status: 200 });
        }

        // استدعاء دالة معالجة الاعتماد المالية الرسمية من النظام
        const { handleApprovalResponse } = await import('@/lib/notifications');
        const result = await handleApprovalResponse(
          action,
          transactionType,
          transactionId,
          requesterId,
          chatId?.toString() || ''
        );

        // إرسال إشعار تجميد الأزرار لتليجرام لإيقاف مؤشر الانتظار (Stop Spinner)
        await answerCallback(callbackQueryId, result.message);

        // تحديث رسالة تليجرام لعرض الحالة النهائية المعتمدة
        if (botToken) {
          const finalStatusText = action === 'approve'
            ? `🟢 <b>تم اعتماد المعاملة بنجاح!</b>\n\nالإجراء: <b>موافق ومعتمد ✅</b>\nبواسطة مشرف الدردشة رقم: <code>${chatId}</code>`
            : `🔴 <b>تم رفض اعتماد المعاملة!</b>\n\nالإجراء: <b>مرفوض وملغى ❌</b>\nبواسطة مشرف الدردشة رقم: <code>${chatId}</code>`;

          await editTelegramMessage(botToken, chatId, messageId, finalStatusText);
        }
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });

  } catch (err) {
    console.error('[Telegram Webhook Error]:', err);
    return NextResponse.json({ success: false, error: 'Internal logic error' }, { status: 200 });
  }
}

/**
 * إبلاغ خوادم تليجرام بإلغاء مؤشر التحميل على العميل
 */
async function answerCallback(callbackQueryId: string, text: string, showAlert = false) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.startsWith('sk_') 
    ? process.env.TELEGRAM_BOT_TOKEN 
    : '8946794048:AAEoxOAsWWFSNKxpawtwcpvo2nIy0Pf6N9I';
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
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('Failed to edit Telegram message:', e);
  }
}
