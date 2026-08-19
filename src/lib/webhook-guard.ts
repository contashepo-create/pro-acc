import { timingSafeEqual } from 'crypto';

/**
 * Telegram webhook secret verification (fail-closed in production).
 *
 * Hardened deployments set TELEGRAM_WEBHOOK_SECRET and register the bot
 * webhook with the same token (scripts/register-telegram-webhook.mjs). The
 * rules are:
 *
 *  - Production + secret configured  → header must be present and match
 *    (timing-safe). A missing header is rejected too: re-register the
 *    webhook with the secret token instead of silently accepting unsigned
 *    updates forever.
 *  - Production + secret NOT configured → every update is REJECTED and a
 *    loud warning is logged. Accepting unsigned webhook traffic in
 *    production would let an attacker forge bot messages, answer inline
 *    buttons and spam the company's Telegram chat.
 *  - Development → accepts without the secret for local testing, with a
 *    warning.
 */
export type WebhookSecretCheck = { ok: boolean; reason: string };

export function verifyWebhookSecret(
  supplied: string | null,
  expected: string | null,
  isProduction: boolean,
): WebhookSecretCheck {
  const configured = (expected || '').trim();

  if (!configured) {
    if (isProduction) {
      return {
        ok: false,
        reason:
          'TELEGRAM_WEBHOOK_SECRET is not configured — refusing unsigned webhook update in production. ' +
          'Set TELEGRAM_WEBHOOK_SECRET and re-register the webhook with the same token.',
      };
    }
    return { ok: true, reason: 'development: TELEGRAM_WEBHOOK_SECRET not configured — accepting for local testing' };
  }

  if (!supplied) {
    if (isProduction) {
      return {
        ok: false,
        reason:
          'Webhook update carries no secret header in production — re-register the webhook with the secret token to enforce verification.',
      };
    }
    return {
      ok: true,
      reason: 'development: update carries no secret header (legacy registration?) — accepting for compatibility',
    };
  }

  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return { ok, reason: ok ? 'secret token verified' : 'webhook secret token mismatch' };
}
