#!/usr/bin/env node
/**
 * Registers (or re-registers) the Telegram bot webhook for the deployed app.
 *
 * This is the operational half of the Telegram approval buttons: the bot only
 * delivers /start messages and inline-button presses (موافق / رفض) to the URL
 * registered here. If the webhook still points at an old deployment URL or at
 * the legacy /api/telegram/callback path, or was registered without the
 * shared secret, every button press silently dies.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=123:ABC \
 *   TELEGRAM_WEBHOOK_SECRET=<random 32+ chars, same value as in the app env> \
 *   APP_URL=https://app.example.com \
 *   node scripts/register-telegram-webhook.mjs
 *
 * The secret token is optional but strongly recommended: when it is set here
 * AND in the app environment, the webhook endpoint enforces that Telegram is
 * the real sender of every update.
 */

const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');

if (!botToken) {
  console.error('Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}
if (!appUrl) {
  console.error('Missing APP_URL (or NEXT_PUBLIC_APP_URL) — the public base URL of the deployed app');
  process.exit(1);
}

const webhookUrl = `${appUrl}/api/telegram/webhook`;

const payload = {
  url: webhookUrl,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: false,
  ...(secret ? { secret_token: secret } : {}),
};

console.log(`Registering webhook: ${webhookUrl}${secret ? ' (with secret token)' : ' (WITHOUT secret token — set TELEGRAM_WEBHOOK_SECRET in the app too when you add one)'}`);

const register = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const registerBody = await register.json();
console.log('setWebhook:', JSON.stringify(registerBody));
if (!registerBody.ok) process.exit(1);

const info = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
const infoBody = await info.json();
console.log('getWebhookInfo:', JSON.stringify(infoBody, null, 2));
if (!infoBody.ok) process.exit(1);

console.log('\nDone. Inline buttons (موافق ✅ / رفض ❌) are now delivered to the app.');
if (!secret) {
  console.warn('NOTE: registered without a secret token. The webhook endpoint will accept updates unverified.\n'
    + 'To harden later: set TELEGRAM_WEBHOOK_SECRET in the app environment and re-run this script with the same value.');
}
