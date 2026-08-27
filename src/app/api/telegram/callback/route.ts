/**
 * Legacy webhook-URL compatibility alias.
 *
 * Bots whose setWebhook URL still points at /api/telegram/callback are served
 * by the exact same handler as /api/telegram/webhook, including the same
 * secret-token verification rules. Answering 410 Gone here (the previous
 * behaviour) silently killed every inline button for those deployments:
 * Telegram accepted the response and simply never surfaced the click to the
 * user, which is exactly what an unresponsive "موافق" button looks like.
 * Register new/updated webhooks with scripts/register-telegram-webhook.mjs.
 */
export { POST } from '../webhook/route';

/** Health/probe helper for operators verifying the endpoint is reachable. */
export function GET() {
  return Response.json({ success: true, message: 'Telegram callback endpoint is live' });
}
