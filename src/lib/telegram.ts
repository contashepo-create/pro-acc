const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID!;

const TELEGRAM_API = 'https://api.telegram.org';

export async function sendTelegramCode(code: string): Promise<boolean> {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn('Telegram not configured: missing BOT_TOKEN or ADMIN_CHAT_ID');
    return false;
  }

  const message = `🔐 رمز التحقق للوحة المطور:\n\n<code>${escapeTelegram(code)}</code>\n\nصلاحية الرمز: 5 دقائق`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, {
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
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn('Telegram not configured: missing BOT_TOKEN or ADMIN_CHAT_ID');
    return false;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn('Telegram notification failed:', res.status, body);
    }
    return res.ok;
  } catch (err) {
    console.warn('Telegram notification error:', err);
    return false;
  }
}

function escapeTelegram(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
