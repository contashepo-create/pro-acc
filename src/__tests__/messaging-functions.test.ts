const mailer = jest.fn();
const telegramSender = jest.fn();
const escapeTelegramHtml = jest.fn((value: string) => value.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
const rpc = jest.fn();
let overdueResult: { data: unknown[] | null; error: unknown } = { data: [], error: null };

const db = {
  rpc,
  from: jest.fn(() => {
    const api = {
      select: () => api, eq: () => api, lt: async () => overdueResult,
      maybeSingle: async () => ({ data: { currency_symbol: 'ر.س', locale: 'ar-SA' }, error: null }),
    };
    return api;
  }),
};

jest.mock('@/lib/email', () => ({ sendEmail: mailer }));
jest.mock('@/lib/telegram', () => ({ sendTelegramMessage: telegramSender, escapeTelegramHtml }));
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import {
  TEMPLATES, buildWhatsAppUrl, sendEmail, sendTelegram, renderTemplate,
  sendMessage, sendInvoiceReminder, sendOverdueReminders,
} from '@/lib/messaging';

beforeEach(() => {
  jest.clearAllMocks();
  overdueResult = { data: [], error: null };
});

describe('message templates and channel adapters', () => {
  test('builds a normalized encoded WhatsApp deep link', () => {
    expect(buildWhatsAppUrl('+966 50-123-4567', 'مرحبا & hello'))
      .toBe(`https://wa.me/966501234567?text=${encodeURIComponent('مرحبا & hello')}`);
  });

  test('renders every occurrence of provided variables and leaves unknown placeholders', () => {
    expect(renderTemplate('{{name}} / {{name}} / {{missing}}', { name: 'Ali' })).toBe('Ali / Ali / {{missing}}');
    expect(TEMPLATES.invoice_overdue_ar.language).toBe('ar');
  });

  test('propagates email provider true/false/errors', async () => {
    mailer.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('down'));
    await expect(sendEmail({ to: 'a@test.com', subject: 's', body: 'b' })).resolves.toEqual({ sent: true });
    await expect(sendEmail({ to: 'a@test.com', subject: 's', body: 'b' })).resolves.toMatchObject({ sent: false });
    await expect(sendEmail({ to: 'a@test.com', subject: 's', body: 'b' })).resolves.toEqual({ sent: false, error: 'down' });
  });

  test('propagates Telegram boolean results and catches errors', async () => {
    telegramSender.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('down'));
    await expect(sendTelegram('1', 'hello')).resolves.toEqual({ sent: true });
    await expect(sendTelegram('1', 'hello')).resolves.toEqual({ sent: false });
    await expect(sendTelegram('1', 'hello')).resolves.toEqual({ sent: false });
  });

  test('dispatches WhatsApp, escaped email, escaped Telegram and unsupported channels', async () => {
    await expect(sendMessage({ channel: 'whatsapp', to: '+1', template: 'general_ar', variables: { message: 'Hi' } }))
      .resolves.toMatchObject({ sent: true, channel: 'whatsapp', url: expect.stringContaining('wa.me/1') });
    await expect(sendMessage({ channel: 'whatsapp', to: '+1', template: 'invoice_overdue_ar' })).resolves.toMatchObject({ sent: true });

    mailer.mockResolvedValueOnce(true);
    await sendMessage({ channel: 'email', to: 'a@test.com', template: '<b>{{name}}</b>\nnext', variables: { name: '<Admin>' } });
    expect(mailer.mock.calls[0][2]).toBe('&lt;b&gt;&lt;Admin&gt;&lt;/b&gt;<br>next');

    telegramSender.mockResolvedValueOnce(true);
    await sendMessage({ channel: 'telegram', to: '1', template: '{{message}}', variables: { message: '<b>attack</b>' } });
    expect(escapeTelegramHtml).toHaveBeenCalledWith('<b>attack</b>');
    expect(telegramSender).toHaveBeenCalledWith('1', '&lt;b&gt;attack&lt;/b&gt;');

    await expect(sendMessage({ channel: 'email', to: 'a@test.com', template: null as unknown as string })).resolves.toMatchObject({ channel: 'email' });
    await expect(sendMessage({ channel: 'sms', to: '1', template: 'x' }))
      .resolves.toEqual({ sent: false, channel: 'sms', error: 'Channel not supported' });
  });
});

describe('invoice reminder orchestration', () => {
  test('reserves, sends and finalizes one reminder', async () => {
    const due = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    rpc
      .mockResolvedValueOnce({ data: { reminder_id: 'r1', channel: 'whatsapp', phone: '+9665', customer_name: 'Ali', invoice_number: 7, amount: 115, due_date: due, company_name: 'Co' }, error: null })
      .mockResolvedValueOnce({ data: {}, error: null });
    const result = await sendInvoiceReminder('c1', 'u1', 'i1');
    expect(result).toMatchObject({ sent: true, channel: 'whatsapp', customerName: 'Ali' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'begin_invoice_reminder_attempt_atomic', { p_company_id: 'c1', p_invoice_id: 'i1', p_user_id: 'u1' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'finish_invoice_reminder_attempt_atomic', expect.objectContaining({ p_reminder_id: 'r1', p_sent: true }));
  });

  test('uses email recipient and fallback reminder fields while recording send failure', async () => {
    mailer.mockResolvedValueOnce(false);
    rpc.mockResolvedValueOnce({ data: { reminder_id: null, channel: 'email', email: 'a@test.com', customer_name: null, invoice_number: null, amount: null, due_date: null, company_name: null }, error: null })
      .mockResolvedValueOnce({ data: {}, error: null });
    await expect(sendInvoiceReminder('c', 'u', 'i')).resolves.toMatchObject({ sent: false, channel: 'email', customerName: 'العميل' });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_reminder_id: 'null', p_message_url: null, p_error: 'تعذر إرسال البريد الإلكتروني' });
    mailer.mockResolvedValueOnce(false);
    rpc.mockResolvedValueOnce({ data: { reminder_id: 'r2', channel: 'email', email: null, due_date: '' }, error: null }).mockResolvedValueOnce({ data: {}, error: null });
    await expect(sendInvoiceReminder('c', 'u', 'i')).resolves.toMatchObject({ sent: false });
    rpc.mockResolvedValueOnce({ data: { reminder_id: 'r3', channel: 'whatsapp', phone: null, due_date: '2026-01-01' }, error: null }).mockResolvedValueOnce({ data: {}, error: null });
    await expect(sendInvoiceReminder('c', 'u', 'i')).resolves.toMatchObject({ sent: true, url: expect.stringContaining('wa.me/?') });
  });

  test('fails when reservation or finalization fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('reserve') });
    await expect(sendInvoiceReminder('c', 'u', 'i')).rejects.toThrow('reserve');
    rpc.mockResolvedValueOnce({ data: { reminder_id: 'r', channel: 'whatsapp', phone: '1', due_date: '2026-01-01' }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('finish') });
    await expect(sendInvoiceReminder('c', 'u', 'i')).rejects.toThrow('finish');
  });

  test('processes overdue invoices serially and records individual failures', async () => {
    overdueResult = { data: [
      { id: 'i1', contacts: { name: 'Ali' } },
      { id: 'i2', contacts: { name: 'Mona' } },
    ], error: null };
    rpc
      .mockResolvedValueOnce({ data: { reminder_id: 'r1', channel: 'whatsapp', phone: '1', customer_name: 'Ali', due_date: '2026-01-01' }, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('blocked') });
    const result = await sendOverdueReminders('c1', 'u1');
    expect(result).toMatchObject({ sent: 1, failed: 1 });
    expect(result.results[1]).toMatchObject({ invoiceId: 'i2', customerName: 'Mona', sent: false, error: 'blocked' });
  });

  test('uses fallback customer/error for non-Error reminder failures', async () => {
    overdueResult = { data: [{ id: 'i1', contacts: null }], error: null };
    rpc.mockResolvedValueOnce({ data: null, error: 'blocked-string' });
    const result = await sendOverdueReminders('c', 'u');
    expect(result.results[0]).toEqual({ invoiceId: 'i1', customerName: 'العميل', sent: false, error: 'تعذر إرسال التذكير' });
  });

  test('surfaces overdue query errors and handles empty/null lists', async () => {
    overdueResult = { data: null, error: new Error('query') };
    await expect(sendOverdueReminders('c', 'u')).rejects.toThrow('query');
    overdueResult = { data: null, error: null };
    await expect(sendOverdueReminders('c', 'u')).resolves.toEqual({ sent: 0, failed: 0, results: [] });
    overdueResult = { data: [], error: null };
    await expect(sendOverdueReminders('c', 'u')).resolves.toEqual({ sent: 0, failed: 0, results: [] });
  });
});
