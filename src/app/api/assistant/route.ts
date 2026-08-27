import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, requireModulePermission, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const requestSchema = z.object({ message: z.string().trim().min(1).max(1000) }).strict();
const amount = (value: unknown) => Number(value) || 0;

/** A deterministic assistant backed by one tenant-scoped posted-ledger snapshot. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const parsed = requestSchema.safeParse(await parseBody<unknown>(request));
    if (!parsed.success) return error('الرسالة مطلوبة ويجب ألا تتجاوز 1000 حرف');

    const message = parsed.data.message.toLowerCase();
    const financialIntent = ['ميزان', 'أرباح', 'خسائر', 'ربح', 'إيراد', 'مصروف', 'profit'].some((word) => message.includes(word));
    const invoiceIntent = message.includes('فاتور') || message.includes('invoice');
    const journalIntent = message.includes('قيد') || message.includes('journal');
    const contactIntent = ['عميل', 'مورد', 'client', 'supplier'].some((word) => message.includes(word));
    const projectIntent = message.includes('مشروع') || message.includes('project');

    if (!financialIntent && !invoiceIntent && !journalIntent && !contactIntent && !projectIntent) {
      return success({
        response: '🤖 **مرحباً! أنا مساعدك المحاسبي.**\n\nيمكنني تلخيص الأرباح والمصروفات، الفواتير المستحقة، القيود المنشورة، الأطراف، والمشاريع.\n\nجرّب أن تسأل: "كم أرباحي؟" أو "ما قيمة الفواتير المتأخرة؟"',
        suggestions: [
          { text: 'كم أرباحي؟' }, { text: 'كم فاتورة متأخرة؟' },
          { text: 'ملخص المشاريع' }, { text: 'عدد العملاء' },
        ],
      });
    }

    const { data, error: snapshotError } = await getSupabase().rpc('get_assistant_company_snapshot', {
      p_company_id: auth.companyId,
    });
    if (snapshotError) throw snapshotError;
    const snapshot = (data || {}) as Record<string, unknown>;

    if (financialIntent) {
      const revenue = amount(snapshot.revenue);
      const expenses = amount(snapshot.expenses);
      const profit = amount(snapshot.netProfit);
      const margin = revenue === 0 ? null : (profit / revenue) * 100;
      return success({
        response: `📊 **تحليل الدفتر المنشور:**\n\n• صافي الإيرادات: ${revenue.toFixed(2)} ر.س\n• صافي المصروفات: ${expenses.toFixed(2)} ر.س\n• ${profit >= 0 ? '✅ صافي الربح' : '❌ صافي الخسارة'}: ${Math.abs(profit).toFixed(2)} ر.س${margin === null ? '' : `\n• هامش الربح: ${margin.toFixed(1)}%`}`,
        suggestions: [{ text: 'عرض قائمة الدخل', action: '/reports' }, { text: 'تحليل المصروفات', action: '/reports' }],
      });
    }

    if (invoiceIntent) {
      return success({
        response: `📄 **ملخص الفواتير المرحلة:**\n\n• فواتير غير مسددة: ${amount(snapshot.unpaidInvoices)}\n• الرصيد المستحق: ${amount(snapshot.outstandingInvoices).toFixed(2)} ر.س\n• الرصيد المتأخر: ${amount(snapshot.overdueInvoices).toFixed(2)} ر.س`,
        suggestions: [{ text: 'إنشاء فاتورة جديدة', action: '/invoices' }, { text: 'الفواتير المتأخرة', action: '/invoices?status=unpaid' }],
      });
    }

    if (journalIntent) {
      return success({
        response: `📒 **ملخص القيود المنشورة:**\n\n• إجمالي القيود: ${amount(snapshot.journalEntries)}\n• قيود هذا الشهر: ${amount(snapshot.monthJournalEntries)}`,
        suggestions: [{ text: 'إضافة قيد جديد', action: '/journal' }, { text: 'عرض آخر القيود', action: '/journal' }],
      });
    }

    if (contactIntent) {
      return success({
        response: `👥 **ملخص الأطراف:**\n\n• العملاء: ${amount(snapshot.clients)}\n• الموردون: ${amount(snapshot.suppliers)}`,
        suggestions: [{ text: 'عرض العملاء', action: '/clients' }, { text: 'إضافة عميل جديد', action: '/clients' }],
      });
    }

    const names = Array.isArray(snapshot.activeProjectNames) ? snapshot.activeProjectNames.map(String) : [];
    return success({
      response: `🏗️ **ملخص المشاريع:**\n\n• إجمالي المشاريع: ${amount(snapshot.totalProjects)}\n• مشاريع نشطة: ${amount(snapshot.activeProjects)}\n• مشاريع مكتملة: ${amount(snapshot.completedProjects)}${names.length ? `\n\n**المشاريع النشطة:**\n${names.map((name) => `• ${name}`).join('\n')}` : ''}`,
      suggestions: [{ text: 'عرض المشاريع', action: '/projects' }, { text: 'تكاليف المشاريع', action: '/projects' }],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
