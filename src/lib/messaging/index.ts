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
    await mailer(params.to, params.subject, params.body);
    return { sent: true };
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
    await sendTelegramMessage(chatId, message);
    return { sent: true };
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
      const result = await sendEmail({
        to: req.to,
        subject: subject || 'إشعار من نظام المحاسبة',
        body,
        attachments: req.attachments,
      });
      return {
        sent: result.sent,
        channel: 'email',
        error: result.error,
      };
    }

    case 'telegram': {
      const result = await sendTelegram(req.to, body);
      return { sent: result.sent, channel: 'telegram' };
    }

    default:
      return { sent: false, channel: req.channel, error: 'Channel not supported' };
  }
}

/**
 * Send invoice reminder to all overdue invoices
 */
export async function sendOverdueReminders(companyId: string): Promise<{
  sent: number;
  failed: number;
  results: Array<{ invoiceId: string; customerName: string; sent: boolean; error?: string }>;
}> {
  const { getSupabase } = await import('@/lib/supabase-client');
  const s = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  // Get overdue invoices
  const { data: overdue } = await s.from('invoices')
    .select('id, number, total, due_date, contact_id, contacts(name, phone, email)')
    .eq('company_id', companyId)
    .eq('status', 'unpaid')
    .lt('due_date', today);

  // Get company name
  const { data: company } = await s.from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();
  const companyName = (company as { name?: string } | null)?.name || 'شركتنا';

  const results: Array<{ invoiceId: string; customerName: string; sent: boolean; error?: string }> = [];
  let sent = 0;
  let failed = 0;

  for (const inv of (overdue || [])) {
    const i = inv as {
      id: string; number: number; total: number; due_date: string;
      contacts: { name: string; phone?: string; email?: string } | null;
    };
    if (!i.contacts) continue;

    const daysOverdue = Math.floor(
      (new Date(today).getTime() - new Date(i.due_date).getTime()) / 86400000
    );

    const variables = {
      customer_name: i.contacts.name,
      invoice_number: String(i.number),
      amount: parseFloat(String(i.total)).toFixed(2),
      due_date: new Date(i.due_date).toLocaleDateString('ar-SA'),
      days_overdue: String(daysOverdue),
      company_name: companyName,
    };

    // Try WhatsApp first, then email
    if (i.contacts.phone) {
      const waResult = await sendMessage({
        channel: 'whatsapp',
        to: i.contacts.phone,
        template: 'invoice_overdue_ar',
        variables,
      });
      results.push({ invoiceId: i.id, customerName: i.contacts.name, sent: waResult.sent, error: waResult.error });
      waResult.sent ? sent++ : failed++;
    } else if (i.contacts.email) {
      const emailResult = await sendMessage({
        channel: 'email',
        to: i.contacts.email,
        template: 'invoice_overdue_ar',
        variables,
      });
      results.push({ invoiceId: i.id, customerName: i.contacts.name, sent: emailResult.sent, error: emailResult.error });
      emailResult.sent ? sent++ : failed++;
    }
  }

  return { sent, failed, results };
}
