/**
 * Multi-Channel Messaging System
 * 
 * Supports: WhatsApp, Email, Telegram, SMS (via SMS gateway)
 * 
 * WhatsApp Business API options:
 * - Option 1: WhatsApp Business Cloud API (Meta official) — requires business verification
 * - Option 2: wa.me deep links — free, opens WhatsApp with pre-filled message
 * - Option 3: Third-party (Twilio, 360dialog) — paid, easier setup
 * 
 * This implementation uses wa.me links (zero-cost, works immediately)
 * with option to upgrade to official API later.
 */

export type Channel = 'whatsapp' | 'email' | 'telegram' | 'sms';

interface MessageTemplate {
  id: string;
  channel: Channel;
  subject?: string;  // For email
  body: string;      // Supports {{variable}} placeholders
  language: 'ar' | 'en';
}

interface SendMessageRequest {
  channel: Channel;
  to: string;        // Phone (whatsapp/sms) or email address
  template: string;  // Template ID or raw message
  variables?: Record<string, string>;
  attachments?: Array<{ filename: string; url: string }>;
}

// ===== Predefined Templates =====

export const TEMPLATES: Record<string, MessageTemplate> = {
  // Invoice reminders
  'invoice_overdue_ar': {
    id: 'invoice_overdue_ar',
    channel: 'whatsapp',
    body: `السلام عليكم {{customer_name}}،

نود تذكيركم بالفاتورة رقم #{{invoice_number}} المستحقة منذ {{days_overdue}} يوم.

المبلغ المستحق: {{amount}} ر.س
تاريخ الاستحقاق: {{due_date}}

نرجو السداد في أقرب وقت. شكراً لتعاونكم.

— {{company_name}}`,
    language: 'ar',
  },
  'invoice_overdue_en': {
    id: 'invoice_overdue_en',
    channel: 'whatsapp',
    body: `Dear {{customer_name}},

This is a reminder for invoice #{{invoice_number}} which is overdue by {{days_overdue}} days.

Amount due: {{amount}} SAR
Due date: {{due_date}}

Please arrange payment at your earliest convenience.

— {{company_name}}`,
    language: 'en',
  },
  'invoice_sent_ar': {
    id: 'invoice_sent_ar',
    channel: 'whatsapp',
    body: `السلام عليكم {{customer_name}}،

تم إصدار الفاتورة رقم #{{invoice_number}} بمبلغ {{amount}} ر.س.

تاريخ الاستحقاق: {{due_date}}

يمكنكم الاطلاع عليها من الرابط: {{invoice_link}}

شكراً لتعاملكم معنا.

— {{company_name}}`,
    language: 'ar',
  },
  'payment_received_ar': {
    id: 'payment_received_ar',
    channel: 'whatsapp',
    body: `السلام عليكم {{customer_name}}،

تم استلام دفعتكم بقيمة {{amount}} ر.س للفاتورة رقم #{{invoice_number}}.

شكراً لكم.

— {{company_name}}`,
    language: 'ar',
  },
  // Salary notifications
  'salary_ready_ar': {
    id: 'salary_ready_ar',
    channel: 'whatsapp',
    body: `السلام عليكم {{employee_name}}،

تم إعداد راتب شهر {{month}}. يمكنك مراجعة كشف الراتب من النظام.

— {{company_name}}`,
    language: 'ar',
  },
  // General
  'general_ar': {
    id: 'general_ar',
    channel: 'whatsapp',
    body: '{{message}}',
    language: 'ar',
  },
  'general_en': {
    id: 'general_en',
    channel: 'whatsapp',
    body: '{{message}}',
    language: 'en',
  },
};

// ===== Channel Handlers =====

/**
 * Send via WhatsApp using wa.me deep link
 * Returns a URL that can be opened in browser/app
 */
export function buildWhatsAppUrl(phoneNumber: string, message: string): string {
  // Clean phone number — remove +, spaces, dashes
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${cleanPhone}?text=${encoded}`;
}

/**
 * Send via Email using nodemailer
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; url: string }>;
}): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  try {
    const { sendEmail: mailer } = await import('@/lib/email');
    const sent = await mailer(params.to, params.subject, params.body);
    return sent ? { sent: true } : { sent: false, error: 'تعذر إرسال البريد الإلكتروني' };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

/**
 * Send via Telegram (already implemented in lib/telegram.ts)
 */
export async function sendTelegram(chatId: string, message: string): Promise<{ sent: boolean }> {
  try {
    const { sendTelegramMessage } = await import('@/lib/telegram');
    return { sent: await sendTelegramMessage(chatId, message) };
  } catch {
    return { sent: false };
  }
}

// ===== Main Send Function =====

/**
 * Render a template with variables
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/** Escape user-controlled text before it is embedded in email HTML. */
function escapeHtmlText(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send a message through any channel
 */
export async function sendMessage(req: SendMessageRequest): Promise<{
  sent: boolean;
  channel: Channel;
  url?: string;    // WhatsApp URL or email link
  error?: string;
}> {
  // Resolve template
  const template = TEMPLATES[req.template];
  const body = template
    ? renderTemplate(template.body, req.variables || {})
    : renderTemplate(req.template, req.variables || {});
  const subject = template?.subject || '';

  switch (req.channel) {
    case 'whatsapp': {
      const url = buildWhatsAppUrl(req.to, body);
      return { sent: true, channel: 'whatsapp', url };
    }

    case 'email': {
      // The body is rendered from templates with user-controlled variables
      // (customer names, amounts, …). Escape it before it is treated as HTML
      // by the mailer, and preserve line breaks.
      const safeBody = escapeHtmlText(body).replace(/\r?\n/g, '<br>');
      const result = await sendEmail({
        to: req.to,
        subject: subject || 'إشعار من نظام المحاسبة',
        body: safeBody,
        attachments: req.attachments,
      });
      return {
        sent: result.sent,
        channel: 'email',
        error: result.error,
      };
    }

    case 'telegram': {
      // Templates carry no intentional markup; escape everything so a
      // malicious customer name cannot inject Telegram HTML tags.
      const { escapeTelegramHtml: escapeTelegram } = await import('@/lib/telegram');
      const result = await sendTelegram(req.to, escapeTelegram(body));
      return { sent: result.sent, channel: 'telegram' };
    }

    default:
      return { sent: false, channel: req.channel, error: 'Channel not supported' };
  }
}

/** Reserve, send and finalize one tenant invoice reminder. */
export async function sendInvoiceReminder(companyId: string, userId: string, invoiceId: string): Promise<{
  sent: boolean;
  channel: Channel;
  url?: string;
  error?: string;
  customerName: string;
}> {
  const { getSupabase } = await import('@/lib/supabase-client');
  const s = getSupabase();
  const { data: reservation, error: reservationError } = await s.rpc('begin_invoice_reminder_attempt_atomic', {
    p_company_id: companyId,
    p_invoice_id: invoiceId,
    p_user_id: userId,
  });
  if (reservationError) throw reservationError;
  const row = reservation as Record<string, unknown>;
  const channel = String(row.channel) as Channel;
  const recipient = channel === 'whatsapp' ? String(row.phone || '') : String(row.email || '');
  const dueDate = String(row.due_date || '');
  const result = await sendMessage({
    channel,
    to: recipient,
    template: 'invoice_overdue_ar',
    variables: {
      customer_name: String(row.customer_name || 'العميل'),
      invoice_number: String(row.invoice_number || ''),
      amount: Number(row.amount || 0).toFixed(2),
      due_date: new Date(dueDate).toLocaleDateString('ar-SA'),
      days_overdue: String(Math.max(0, Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000))),
      company_name: String(row.company_name || 'شركتنا'),
    },
  });
  const { error: finalizationError } = await s.rpc('finish_invoice_reminder_attempt_atomic', {
    p_company_id: companyId,
    p_reminder_id: String(row.reminder_id),
    p_user_id: userId,
    p_sent: result.sent,
    p_message_url: result.url || null,
    p_error: result.error || null,
  });
  if (finalizationError) throw finalizationError;
  return { ...result, customerName: String(row.customer_name || 'العميل') };
}

/** Send each overdue invoice through a serialized, auditable reservation. */
export async function sendOverdueReminders(companyId: string, userId: string): Promise<{
  sent: number;
  failed: number;
  results: Array<{ invoiceId: string; customerName: string; sent: boolean; error?: string }>;
}> {
  const { getSupabase } = await import('@/lib/supabase-client');
  const s = getSupabase();
  const today = new Date().toISOString().split('T')[0];
  const { data: overdue, error: queryError } = await s.from('invoices')
    .select('id, contacts(name)')
    .eq('company_id', companyId).eq('status', 'unpaid').lt('due_date', today);
  if (queryError) throw queryError;

  const results: Array<{ invoiceId: string; customerName: string; sent: boolean; error?: string }> = [];
  for (const invoice of overdue || []) {
    const row = invoice as unknown as { id: string; contacts?: { name?: string } | null };
    try {
      const result = await sendInvoiceReminder(companyId, userId, row.id);
      results.push({ invoiceId: row.id, customerName: result.customerName, sent: result.sent, error: result.error });
    } catch (sendError) {
      results.push({
        invoiceId: row.id,
        customerName: row.contacts?.name || 'العميل',
        sent: false,
        error: sendError instanceof Error ? sendError.message : 'تعذر إرسال التذكير',
      });
    }
  }
  return {
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent).length,
    results,
  };
}
