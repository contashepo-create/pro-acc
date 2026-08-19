function clean(s: string): string {
  return (s || '').replace(/^\uFEFF/, '').trim();
}

/** Returns the configured Telegram bot token without embedding a credential in source. */
export function getBotToken(): string {
  return clean(process.env.TELEGRAM_BOT_TOKEN || '');
}

const BOT_TOKEN = getBotToken();
const ADMIN_CHAT_ID = clean(process.env.TELEGRAM_ADMIN_CHAT_ID || '');

const TELEGRAM_API = 'https://api.telegram.org';

export async function sendTelegramCode(code: string): Promise<boolean> {
  const token = getBotToken();
  if (!token || !ADMIN_CHAT_ID) {
    console.warn('Telegram not configured: missing BOT_TOKEN or ADMIN_CHAT_ID');
    return false;
  }

  const message = `🔐 رمز التحقق للوحة المطور:\n\n<code>${escapeTelegramHtml(code)}</code>\n\nصلاحية الرمز: 5 دقائق`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text();
      console.warn('Telegram sendCode failed:', res.status, body);
    }
    return res.ok;
  } catch (err) {
    clearTimeout(timeout);
    console.warn('Telegram sendCode error:', err);
    return false;
  }
}

export async function sendAdminNotification(text: string): Promise<boolean> {
  const token = getBotToken();
  if (!token || !ADMIN_CHAT_ID) {
    console.warn('Telegram not configured: missing BOT_TOKEN or ADMIN_CHAT_ID');
    return false;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn('Telegram notification error:', err);
    return false;
  }
}

export async function sendTelegramMessage(chatId: string, message: string): Promise<boolean> {
  const token = getBotToken();
  if (!token || !chatId) {
    console.warn('Telegram not configured: missing BOT_TOKEN or chatId');
    return false;
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch (err) {
    console.warn('Telegram message error:', err);
    return false;
  }
}

/**
 * Escape user-controlled text before embedding it in Telegram HTML
 * (parse_mode: HTML). Without this, a customer name like `<b>` or an invoice
 * reason containing `<i>` injects markup into the message the owner reads.
 */
export function escapeTelegramHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
