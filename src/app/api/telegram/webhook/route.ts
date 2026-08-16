import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { getSupabase } from '@/lib/supabase-client';

const ok = () => NextResponse.json({ success: true }, { status: 200 });

function hasValidSecret(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const supplied = request.headers.get('x-telegram-bot-api-secret-token') || '';
  return !!expected && supplied.length === expected.length
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!hasValidSecret(request)) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  try {
    const update = await request.json();
    if (update.message) {
      const chatId = String(update.message.chat?.id || '');
      const text = String(update.message.text || '').trim().toLowerCase();
      if (chatId && (text === '/start' || text === 'start') && token) {
        await telegramCall(token, 'sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `🤖 <b>مرحباً بك في بوت برو أكاونت</b>\n\nمعرّف الدردشة الخاص بك:\n<code>${chatId}</code>`,
        });
      }
      return ok();
    }
    const query = update.callback_query;
    if (!query) return ok();
    const callbackId = String(query.id || '');
    const callbackData = String(query.data || '');
    const chatId = String(query.message?.chat?.id || '');
    const messageId = query.message?.message_id;
    if (!callbackId || !chatId || callbackData.length > 128) return ok();
    const supabase = getSupabase();

    if (callbackData.startsWith('test:')) {
      const [kind, action, testId, ...extra] = callbackData.split(':');
      if (kind !== 'test' || extra.length || !['accept', 'reject'].includes(action)) {
        await answerCallback(token, callbackId, 'طلب فحص غير صالح', true); return ok();
      }
      const { data, error: rpcError } = await supabase.rpc('finish_telegram_test_run_atomic', {
        p_test_run_id: testId, p_chat_id: chatId, p_action: action,
      });
      if (rpcError) {
        await answerCallback(token, callbackId, 'انتهى الفحص أو تمت معالجته', true); return ok();
      }
      await answerCallback(token, callbackId, action === 'accept' ? 'تم قبول الفحص ✅' : 'تم رفض الفحص ❌');
      await editMessage(token, chatId, messageId, action === 'accept'
        ? '🟢 <b>تم تأكيد الربط بنجاح ✅</b>' : '🔴 <b>تم رفض فحص الربط ❌</b>');
      void data;
      return ok();
    }

    if (callbackData.startsWith('reset:')) {
      const [, action] = callbackData.split(':'); // Ignore legacy company/requester segments.
      if (!['approve', 'reject'].includes(action)) {
        await answerCallback(token, callbackId, 'طلب غير صالح', true); return ok();
      }
      if (action === 'reject') {
        const { error: rpcError } = await supabase.rpc('reject_telegram_reset_session_atomic', { p_chat_id: chatId });
        if (rpcError) {
          await answerCallback(token, callbackId, 'انتهى الطلب أو تمت معالجته', true); return ok();
        }
        await answerCallback(token, callbackId, 'تم رفض وإلغاء الطلب ❌');
        await editMessage(token, chatId, messageId, '🔴 <b>تم رفض وإلغاء طلب تصفير البيانات.</b>');
        return ok();
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const codeHash = createHash('sha256').update(code).digest('hex');
      const { data: session, error: rpcError } = await supabase.rpc('approve_telegram_reset_session_atomic', {
        p_chat_id: chatId, p_code_hash: codeHash, p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
      if (rpcError) {
        await answerCallback(token, callbackId, 'انتهى الطلب أو تمت معالجته', true); return ok();
      }
      try {
        await telegramCall(token, 'sendMessage', {
          chat_id: chatId, parse_mode: 'HTML',
          text: `🔐 <b>رمز تأكيد تصفير البيانات</b>\n\n<code>${code}</code>\n\nصالح لمدة خمس دقائق فقط.`,
        });
      } catch {
        const details = session as { company_id?: string; requester_id?: string } | null;
        if (details?.company_id && details.requester_id) {
          await supabase.rpc('cancel_telegram_reset_session_atomic', {
            p_company_id: details.company_id, p_requester_id: details.requester_id, p_reason: 'otp_delivery_failed',
          });
        }
        await answerCallback(token, callbackId, 'تعذر إرسال الرمز؛ أُلغي الطلب بأمان', true); return ok();
      }
      await answerCallback(token, callbackId, 'تم إصدار رمز التأكيد 🔐');
      await editMessage(token, chatId, messageId, '🟢 <b>تمت الموافقة وأُرسل رمز التأكيد للمدير.</b>');
      return ok();
    }

    let approvalAction = '';
    let approvalId = '';
    let legacyType = '';
    let legacyEntityId = '';
    if (callbackData.startsWith('approval:')) {
      const [kind, action, id, ...extra] = callbackData.split(':');
      if (kind === 'approval' && !extra.length) { approvalAction = action; approvalId = id; }
    } else if (callbackData.startsWith('approve_')) {
      const parts = callbackData.split('_');
      if (parts.length >= 5) {
        approvalAction = parts[1];
        legacyEntityId = parts[parts.length - 2];
        legacyType = parts.slice(2, parts.length - 2).join('_');
      }
    }
    if (approvalAction || approvalId || legacyEntityId) {
      if (!['approve', 'reject'].includes(approvalAction)) {
        await answerCallback(token, callbackId, 'إجراء اعتماد غير صالح', true); return ok();
      }
      const result = approvalId
        ? await supabase.rpc('respond_approval_by_telegram_atomic', {
            p_approval_id: approvalId, p_action: approvalAction, p_chat_id: chatId, p_comments: '',
          })
        : await supabase.rpc('respond_legacy_approval_by_telegram_atomic', {
            p_action: approvalAction, p_transaction_type: legacyType,
            p_transaction_id: legacyEntityId, p_chat_id: chatId,
          });
      if (result.error) {
        await answerCallback(token, callbackId, 'انتهى الطلب أو لا تملك صلاحية معالجته', true); return ok();
      }
      await answerCallback(token, callbackId, approvalAction === 'approve' ? 'تم اعتماد الطلب ✅' : 'تم رفض الطلب ❌');
      await editMessage(token, chatId, messageId, approvalAction === 'approve'
        ? '🟢 <b>تم اعتماد المعاملة بنجاح ✅</b>' : '🔴 <b>تم رفض المعاملة ❌</b>');
      return ok();
    }

    await answerCallback(token, callbackId, 'طلب غير معروف', true);
    return ok();
  } catch (cause) {
    console.error('[Telegram Webhook Error]', cause instanceof Error ? cause.message : 'unknown');
    return ok(); // Acknowledge malformed/replayed updates so Telegram does not retry indefinitely.
  }
}

async function telegramCall(token: string, method: string, payload: Record<string, unknown>) {
  if (!token) throw new Error('Telegram bot token is not configured');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Telegram ${method} failed with ${response.status}`);
}

async function answerCallback(token: string, id: string, text: string, showAlert = false) {
  try { await telegramCall(token, 'answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert }); } catch {}
}

async function editMessage(token: string, chatId: string, messageId: unknown, text: string) {
  if (!messageId) return;
  try { await telegramCall(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' }); } catch {}
}
