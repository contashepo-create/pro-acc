import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { handleApprovalResponse } from '@/lib/notifications';

function hasValidTelegramSecret(request: NextRequest): boolean {
  const expected = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const supplied = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

/**
 * POST /api/telegram/callback
 * معالج callback queries من بوت التيليجرام
 * يستقبل الردود على أزرار الموافقة/الرفض
 */
export async function POST(request: NextRequest) {
  try {
    // This legacy endpoint performs financial approvals, so it must use the
    // same Telegram secret-token authentication as the primary webhook.
    if (!hasValidTelegramSecret(request)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }
    const body = await request.json();
    
    // التحقق من أن الطلب هو callback_query
    if (!body.callback_query) {
      return NextResponse.json({ success: false, message: 'Invalid callback query' });
    }
    
    const callbackQuery = body.callback_query;
    const callbackData = callbackQuery.data as string;
    const chatId = callbackQuery.message?.chat?.id?.toString();
    
    if (!callbackData || !chatId) {
      return NextResponse.json({ success: false, message: 'Missing callback data or chat ID' });
    }
    
    // تحليل callback_data
    // Format: {action}_{transactionType}_{transactionId}_{userId}
    // Example: approve_voucher_disbursement_abc-123-def_user-456
    const parts = callbackData.split('_');
    
    if (parts.length < 4) {
      return NextResponse.json({ success: false, message: 'Invalid callback data format' });
    }
    
    const action = parts[0] as 'approve' | 'reject';
    const userId = parts[parts.length - 1];
    const requesterId = parts[parts.length - 2];
    const transactionId = parts[parts.length - 3];
    const transactionType = parts.slice(1, parts.length - 3).join('_');
    
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ success: false, message: 'Invalid action' });
    }
    
    // معالجة الرد
    const result = await handleApprovalResponse(
      action,
      transactionType,
      transactionId,
      requesterId,
      chatId
    );
    
    // إرسال إجابة لـ callback query لإزالة أزرار التحميل
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: result.message,
          show_alert: false,
        }),
      });
    }
    
    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error('Error handling Telegram callback:', err);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
