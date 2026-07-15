import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { sendMessage, sendOverdueReminders, renderTemplate, TEMPLATES } from '@/lib/messaging';

const sb = () => getSupabase();

/**
 * GET /api/reminders — Get overdue invoices and reminder status
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const today = new Date().toISOString().split('T')[0];

    // Overdue invoices
    const { data: overdue } = await s.from('invoices')
      .select('id, number, total, due_date, status, contacts(name, phone, email)')
      .eq('company_id', auth.companyId)
      .eq('status', 'unpaid')
      .lt('due_date', today)
      .order('due_date', { ascending: true });

    // Upcoming (due within 7 days)
    const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const { data: upcoming } = await s.from('invoices')
      .select('id, number, total, due_date, contacts(name)')
      .eq('company_id', auth.companyId)
      .eq('status', 'unpaid')
      .gte('due_date', today)
      .lte('due_date', sevenDays)
      .order('due_date');

    // Recent reminders sent
    const { data: recentSent } = await s.from('reminder_log')
      .select('*')
      .eq('company_id', auth.companyId)
      .order('sent_at', { ascending: false })
      .limit(20);

    const overdueWithDays = (overdue || []).map((inv) => {
      const i = inv as { id: string; number: number; total: number; due_date: string; contacts: { name: string; phone?: string; email?: string } | null };
      const days = Math.floor((Date.now() - new Date(i.due_date).getTime()) / 86400000);
      return { ...i, days_overdue: days, has_phone: !!i.contacts?.phone, has_email: !!i.contacts?.email };
    });

    return success({
      overdue: overdueWithDays,
      overdueCount: overdueWithDays.length,
      upcoming: upcoming || [],
      upcomingCount: (upcoming || []).length,
      recentReminders: recentSent || [],
      templates: Object.keys(TEMPLATES),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/reminders — Send reminders
 * 
 * Body options:
 * - { action: 'send_all_overdue' } — Send to all overdue invoices
 * - { action: 'send_single', invoice_id: '...' } — Send for one invoice
 * - { action: 'preview', invoice_id: '...' } — Preview message without sending
 * - { action: 'custom', channel, to, template, variables } — Custom message
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();
    const { action, invoice_id, channel, to, template, variables } = body as {
      action?: string;
      invoice_id?: string;
      channel?: string;
      to?: string;
      template?: string;
      variables?: Record<string, string>;
    };

    if (action === 'send_all_overdue') {
      const result = await sendOverdueReminders(auth.companyId);

      // Log reminders
      for (const r of result.results) {
        try {
          await s.from('reminder_log').insert({
            company_id: auth.companyId,
            invoice_id: r.invoiceId,
            customer_name: r.customerName,
            channel: 'auto',
            status: r.sent ? 'sent' : 'failed',
            error: r.error || null,
            sent_by: auth.userId,
          });
        } catch { /* ignore log errors */ }
      }

      return success({ sent: result.sent, failed: result.failed, results: result.results });
    }

    if (action === 'send_single' && invoice_id) {
      // Fetch invoice
      const { data: invoice } = await s.from('invoices')
        .select('id, number, total, due_date, contacts(name, phone, email)')
        .eq('id', invoice_id)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (!invoice) return error('الفاتورة غير موجودة');
      const inv = invoice as { id: string; number: number; total: number; due_date: string; contacts: { name: string; phone?: string; email?: string } | null };
      if (!inv.contacts) return error('لا توجد بيانات تواصل للعميل');

      const { data: company } = await s.from('companies')
        .select('name').eq('id', auth.companyId).maybeSingle();
      const companyName = (company as { name?: string } | null)?.name || 'شركتنا';

      const vars = {
        customer_name: inv.contacts.name,
        invoice_number: String(inv.number),
        amount: parseFloat(String(inv.total)).toFixed(2),
        due_date: new Date(inv.due_date).toLocaleDateString('ar-SA'),
        days_overdue: String(Math.max(0, Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000))),
        company_name: companyName,
      };

      // Try WhatsApp, then email
      let result;
      if (inv.contacts.phone) {
        result = await sendMessage({ channel: 'whatsapp', to: inv.contacts.phone, template: 'invoice_overdue_ar', variables: vars });
      } else if (inv.contacts.email) {
        result = await sendMessage({ channel: 'email', to: inv.contacts.email, template: 'invoice_overdue_ar', variables: vars });
      } else {
        return error('لا يوجد رقم هاتف أو بريد إلكتروني للعميل');
      }

      // Log
      try {
        await s.from('reminder_log').insert({
          company_id: auth.companyId,
          invoice_id: inv.id,
          customer_name: inv.contacts.name,
          channel: result.channel,
          status: result.sent ? 'sent' : 'failed',
          message_url: result.url || null,
          error: result.error || null,
          sent_by: auth.userId,
        });
      } catch { /* ignore */ }

      return success(result);
    }

    if (action === 'preview' && invoice_id) {
      const { data: invoice } = await s.from('invoices')
        .select('number, total, due_date, contacts(name, phone, email)')
        .eq('id', invoice_id)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (!invoice) return error('الفاتورة غير موجودة');
      const inv = invoice as { number: number; total: number; due_date: string; contacts: { name: string; phone?: string; email?: string } | null };

      const { data: company } = await s.from('companies')
        .select('name').eq('id', auth.companyId).maybeSingle();
      const companyName = (company as { name?: string } | null)?.name || 'شركتنا';

      const vars = {
        customer_name: inv.contacts?.name || 'العميل',
        invoice_number: String(inv.number),
        amount: parseFloat(String(inv.total)).toFixed(2),
        due_date: new Date(inv.due_date).toLocaleDateString('ar-SA'),
        days_overdue: String(Math.max(0, Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000))),
        company_name: companyName,
      };

      const whatsappMsg = renderTemplate(TEMPLATES['invoice_overdue_ar'].body, vars);
      const emailMsg = renderTemplate(TEMPLATES['invoice_overdue_ar'].body, vars);

      return success({
        whatsapp: { preview: whatsappMsg, to: inv.contacts?.phone || null, url: inv.contacts?.phone ? `https://wa.me/${inv.contacts.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(whatsappMsg)}` : null },
        email: { preview: emailMsg, to: inv.contacts?.email || null },
      });
    }

    if (action === 'custom' && channel && to && template) {
      const result = await sendMessage({
        channel: channel as 'whatsapp' | 'email' | 'telegram',
        to,
        template,
        variables: variables || {},
      });
      return success(result);
    }

    return error('عملية غير صالحة');
  } catch (err) {
    return handleApiError(err);
  }
}
