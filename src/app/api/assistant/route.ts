import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * POST /api/assistant - Smart AI Assistant
 * Provides contextual suggestions based on user's question and company data
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const { message, context } = await request.json() as { message: string; context?: string };

    if (!message) {
      return success({ response: 'كيف يمكنني مساعدتك؟' });
    }

    const lowerMsg = message.toLowerCase();
    let response = '';
    let suggestions: Array<{ text: string; action?: string }> = [];

    // Financial analysis queries
    if (lowerMsg.includes('ميزان') || lowerMsg.includes('أرباح') || lowerMsg.includes('خسائر') || lowerMsg.includes('profit')) {
      const { data: jeData } = await s.from('journal_lines')
        .select('debit, credit')
        .in('account_id', (
          await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('type', 'revenue')
        ).data?.map((a: { id: string }) => a.id) || []);
      
      const totalRevenue = (jeData || []).reduce((sum: number, l: { debit: number; credit: number }) => sum + (parseFloat(String(l.credit)) || 0), 0);
      
      const { data: expenseData } = await s.from('journal_lines')
        .select('debit, credit')
        .in('account_id', (
          await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('type', 'expense')
        ).data?.map((a: { id: string }) => a.id) || []);
      
      const totalExpenses = (expenseData || []).reduce((sum: number, l: { debit: number; credit: number }) => sum + (parseFloat(String(l.debit)) || 0), 0);
      const profit = totalRevenue - totalExpenses;

      response = `📊 **تحليل مالي:**\n\n`;
      response += `• إجمالي الإيرادات: ${totalRevenue.toFixed(2)} ر.س\n`;
      response += `• إجمالي المصروفات: ${totalExpenses.toFixed(2)} ر.س\n`;
      response += `• ${profit >= 0 ? '✅ صافي الربح' : '❌ صافي الخسارة'}: ${Math.abs(profit).toFixed(2)} ر.س\n`;
      
      if (totalRevenue > 0) {
        const margin = (profit / totalRevenue * 100).toFixed(1);
        response += `• هامش الربح: ${margin}%\n`;
      }

      suggestions = [
        { text: 'عرض قائمة الدخل', action: '/reports' },
        { text: 'تحليل المصروفات', action: '/reports' },
      ];
    }

    // Invoice queries
    else if (lowerMsg.includes('فاتور') || lowerMsg.includes('invoice')) {
      const { count: unpaid } = await s.from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId)
        .eq('status', 'unpaid');
      
      const { count: overdue } = await s.from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId)
        .eq('status', 'unpaid')
        .lt('due_date', new Date().toISOString().split('T')[0]);
      
      const { data: total } = await s.from('invoices')
        .select('total')
        .eq('company_id', auth.companyId);
      
      const grandTotal = (total || []).reduce((sum: number, inv: { total: number }) => sum + (parseFloat(String(inv.total)) || 0), 0);

      response = `📄 **ملخص الفواتير:**\n\n`;
      response += `• إجمالي الفواتير: ${(total || []).length} فاتورة\n`;
      response += `• إجمالي المبالغ: ${grandTotal.toFixed(2)} ر.س\n`;
      response += `• فواتير غير مدفوعة: ${unpaid || 0}\n`;
      response += `• فواتير متأخرة: ${overdue || 0} ⚠️\n`;

      suggestions = [
        { text: 'إنشاء فاتورة جديدة', action: '/invoices' },
        { text: 'الفواتير المتأخرة', action: '/invoices?status=unpaid' },
      ];
    }

    // Journal entry queries
    else if (lowerMsg.includes('قيد') || lowerMsg.includes('journal')) {
      const { count: totalEntries } = await s.from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId);
      
      const currentMonth = new Date().toISOString().substring(0, 7);
      const { count: monthEntries } = await s.from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId)
        .ilike('date', `${currentMonth}%`);

      response = `📒 **ملخص القيود اليومية:**\n\n`;
      response += `• إجمالي القيود: ${totalEntries || 0} قيد\n`;
      response += `• قيود هذا الشهر: ${monthEntries || 0} قيد\n`;

      suggestions = [
        { text: 'إضافة قيد جديد', action: '/journal' },
        { text: 'عرض آخر القيود', action: '/journal' },
      ];
    }

    // Client/customer queries
    else if (lowerMsg.includes('عميل') || lowerMsg.includes('مورد') || lowerMsg.includes('client')) {
      const { count: clients } = await s.from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId)
        .eq('type', 'client');
      
      const { count: suppliers } = await s.from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId)
        .eq('type', 'supplier');

      response = `👥 **ملخص الأطراف:**\n\n`;
      response += `• العملاء: ${clients || 0}\n`;
      response += `• الموردين: ${suppliers || 0}\n`;
      response += `• الإجمالي: ${(clients || 0) + (suppliers || 0)}\n`;

      suggestions = [
        { text: 'عرض العملاء', action: '/clients' },
        { text: 'إضافة عميل جديد', action: '/clients' },
      ];
    }

    // Project queries
    else if (lowerMsg.includes('مشروع') || lowerMsg.includes('project')) {
      const { data: projects } = await s.from('projects')
        .select('id, name, status, budget, actual_cost')
        .eq('company_id', auth.companyId);

      const active = (projects || []).filter((p: { status: string }) => p.status === 'active').length;
      const completed = (projects || []).filter((p: { status: string }) => p.status === 'completed').length;

      response = `🏗️ **ملخص المشاريع:**\n\n`;
      response += `• إجمالي المشاريع: ${(projects || []).length}\n`;
      response += `• مشاريع نشطة: ${active}\n`;
      response += `• مشاريع مكتملة: ${completed}\n`;

      if ((projects || []).length > 0) {
        response += `\n**المشاريع النشطة:**\n`;
        (projects as Array<{ name: string; status: string }>)
          .filter(p => p.status === 'active')
          .slice(0, 5)
          .forEach(p => { response += `• ${p.name}\n`; });
      }

      suggestions = [
        { text: 'عرض المشاريع', action: '/projects' },
        { text: 'تكاليف المشاريع', action: '/projects' },
      ];
    }

    // General help
    else {
      response = `🤖 **مرحباً! أنا مساعدك المحاسبي.**\n\n`;
      response += `يمكنني مساعدتك في:\n\n`;
      response += `• 📊 **التحليل المالي** — اسأل عن الأرباح، الإيرادات، المصروفات\n`;
      response += `• 📄 **الفواتير** — حالة الفواتير، المتأخرة، الملخصات\n`;
      response += `• 📒 **القيود اليومية** — عدد القيود، ملخصات الشهر\n`;
      response += `• 👥 **العملاء والموردين** — الأعداد والملخصات\n`;
      response += `• 🏗️ **المشاريع** — حالة المشاريع والتكاليف\n`;
      response += `• 💡 **اقتراحات** — نصائح لتحسين إدارة financesك\n\n`;
      response += `جرّب أن تسأل: "كم أرباحي؟" أو "كم فاتورة متأخرة؟"`;

      suggestions = [
        { text: 'كم أرباحي؟' },
        { text: 'كم فاتورة متأخرة؟' },
        { text: 'ملخص المشاريع' },
        { text: 'عدد العملاء' },
      ];
    }

    return success({ response, suggestions });
  } catch (err) {
    return handleApiError(err);
  }
}
