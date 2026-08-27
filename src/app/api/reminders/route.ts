import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { renderTemplate, sendInvoiceReminder, sendOverdueReminders, TEMPLATES } from '@/lib/messaging';
import { reminderActionSchema } from '@/lib/relationship-validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'read');
    const s = sb();
    const today = new Date().toISOString().split('T')[0];
    const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const [overdueResult, upcomingResult, recentResult] = await Promise.all([
      s.from('invoices').select('id, number, total, due_date, status, contacts(name, phone, email)')
        .eq('company_id', auth.companyId).eq('status', 'unpaid').lt('due_date', today).order('due_date'),
      s.from('invoices').select('id, number, total, due_date, contacts(name)')
        .eq('company_id', auth.companyId).eq('status', 'unpaid').gte('due_date', today).lte('due_date', sevenDays).order('due_date'),
      s.from('reminder_log').select('*').eq('company_id', auth.companyId).order('sent_at', { ascending: false }).limit(20),
    ]);
    if (overdueResult.error) throw overdueResult.error;
    if (upcomingResult.error) throw upcomingResult.error;
    if (recentResult.error) throw recentResult.error;
    const overdue = (overdueResult.data || []).map((invoice: Record<string, unknown>) => {
      const contact = invoice.contacts as { phone?: string; email?: string } | null;
      return {
        ...invoice,
        days_overdue: Math.floor((Date.now() - new Date(String(invoice.due_date)).getTime()) / 86400000),
        has_phone: !!contact?.phone,
        has_email: !!contact?.email,
      };
    });
    return success({
      overdue, overdueCount: overdue.length,
      upcoming: upcomingResult.data || [], upcomingCount: (upcomingResult.data || []).length,
      recentReminders: recentResult.data || [], templates: Object.keys(TEMPLATES),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'update');
    if (!['admin', 'manager'].includes(auth.role)) return error('إرسال التذكيرات متاح للمدير فقط', 403);
    const parsed = reminderActionSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const action = parsed.data;
    if (action.action === 'send_all_overdue') {
      const result = await sendOverdueReminders(auth.companyId, auth.userId);
      return success(result);
    }
    if (action.action === 'send_single') {
      try {
        const result = await sendInvoiceReminder(auth.companyId, auth.userId, action.invoice_id);
        return success(result);
      } catch (sendError) {
        const message = String((sendError as { message?: unknown })?.message || 'تعذر إرسال التذكير');
        if (message.includes('غير موجودة')) return error('الفاتورة غير موجودة', 404);
        if (message.includes('اليوم') || message.includes('غير متأخرة')) return error(message, 409);
        if (message.includes('بيانات تواصل') || message.includes('بيانات عميل')) return error(message);
        throw sendError;
      }
    }

    const s = sb();
    const { data: invoice, error: invoiceError } = await s.from('invoices')
      .select('number, total, due_date, contacts(name, phone, email)')
      .eq('id', action.invoice_id).eq('company_id', auth.companyId).maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return error('الفاتورة غير موجودة', 404);
    const { data: company, error: companyError } = await s.from('companies').select('name')
      .eq('id', auth.companyId).maybeSingle();
    if (companyError) throw companyError;
    const row = invoice as unknown as {
      number: number; total: number; due_date: string;
      contacts: { name: string; phone?: string; email?: string } | null;
    };
    const vars = {
      customer_name: row.contacts?.name || 'العميل', invoice_number: String(row.number),
      amount: Number(row.total).toFixed(2), due_date: new Date(String(row.due_date)).toLocaleDateString('ar-SA'),
      days_overdue: String(Math.max(0, Math.floor((Date.now() - new Date(String(row.due_date)).getTime()) / 86400000))),
      company_name: String((company as { name?: string } | null)?.name || 'شركتنا'),
    };
    const message = renderTemplate(TEMPLATES.invoice_overdue_ar.body, vars);
    const phone = row.contacts?.phone;
    return success({
      whatsapp: {
        preview: message,
        to: phone || null,
        url: phone ? `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}` : null,
      },
      email: { preview: message, to: row.contacts?.email || null },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
