import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/reports/analytics — Advanced analytics data for the dashboard
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const now = new Date();
    const currentYear = now.getFullYear();

    // 1. Revenue & Expenses chart (monthly for current year)
    const revenueChart: Array<{ month: string; revenue: number; expenses: number }> = [];
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

    for (let m = 0; m < 12; m++) {
      const monthStr = `${currentYear}-${String(m + 1).padStart(2, '0')}`;

      // Revenue accounts (type = 'revenue')
      const { data: revAccounts } = await s.from('accounts')
        .select('id').eq('company_id', auth.companyId).eq('type', 'revenue');
      const revIds = (revAccounts || []).map((a: { id: string }) => a.id);

      let revenue = 0;
      if (revIds.length > 0) {
        const { data: revLines } = await s.from('journal_lines')
          .select('credit')
          .in('account_id', revIds)
          .gte('created_at', `${monthStr}-01`)
          .lt('created_at', m === 11 ? `${currentYear + 1}-01-01` : `${currentYear}-${String(m + 2).padStart(2, '0')}-01`);
        revenue = (revLines || []).reduce((sum: number, l: { credit: number }) => sum + (parseFloat(String(l.credit)) || 0), 0);
      }

      // Expense accounts (type = 'expense')
      const { data: expAccounts } = await s.from('accounts')
        .select('id').eq('company_id', auth.companyId).eq('type', 'expense');
      const expIds = (expAccounts || []).map((a: { id: string }) => a.id);

      let expenses = 0;
      if (expIds.length > 0) {
        const { data: expLines } = await s.from('journal_lines')
          .select('debit')
          .in('account_id', expIds)
          .gte('created_at', `${monthStr}-01`)
          .lt('created_at', m === 11 ? `${currentYear + 1}-01-01` : `${currentYear}-${String(m + 2).padStart(2, '0')}-01`);
        expenses = (expLines || []).reduce((sum: number, l: { debit: number }) => sum + (parseFloat(String(l.debit)) || 0), 0);
      }

      revenueChart.push({ month: months[m], revenue, expenses });
    }

    // 2. Aging Report (accounts receivable)
    const { data: arAccount } = await s.from('accounts')
      .select('id').eq('company_id', auth.companyId).eq('code', '1130').maybeSingle();

    const agingReport: Array<{ range: string; count: number; amount: number }> = [];
    if (arAccount) {
      const ar = arAccount as { id: string };
      const ranges = [
        { label: 'حالي (0-30 يوم)', min: 0, max: 30 },
        { label: '31-60 يوم', min: 31, max: 60 },
        { label: '61-90 يوم', min: 61, max: 90 },
        { label: '+90 يوم', min: 91, max: 99999 },
      ];

      for (const range of ranges) {
        const startDate = new Date(now.getTime() - range.max * 86400000).toISOString().split('T')[0];
        const endDate = new Date(now.getTime() - range.min * 86400000).toISOString().split('T')[0];

        const { data: invoices } = await s.from('invoices')
          .select('id, total')
          .eq('company_id', auth.companyId)
          .eq('status', 'unpaid')
          .gte('due_date', startDate)
          .lte('due_date', endDate);

        const amount = (invoices || []).reduce((sum: number, inv: { total: number }) => sum + (parseFloat(String(inv.total)) || 0), 0);
        agingReport.push({ range: range.label, count: (invoices || []).length, amount });
      }
    }

    // 3. Top 5 clients by revenue
    const { data: topInvoices } = await s.from('invoices')
      .select('contact_id, total, contacts(name)')
      .eq('company_id', auth.companyId)
      .eq('status', 'paid')
      .order('total', { ascending: false })
      .limit(50);

    const clientMap: Record<string, { name: string; revenue: number; count: number }> = {};
    for (const inv of (topInvoices || [])) {
      const i = inv as { contact_id: string; total: number; contacts: { name: string } | null };
      if (!i.contact_id || !i.contacts) continue;
      if (!clientMap[i.contact_id]) {
        clientMap[i.contact_id] = { name: i.contacts.name, revenue: 0, count: 0 };
      }
      clientMap[i.contact_id].revenue += parseFloat(String(i.total)) || 0;
      clientMap[i.contact_id].count += 1;
    }
    const topClients = Object.values(clientMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // 4. Project profitability
    const { data: projects } = await s.from('projects')
      .select('id, name, budget, actual_cost, status')
      .eq('company_id', auth.companyId)
      .in('status', ['active', 'completed']);

    const projectProfitability = (projects || []).map((p: { name: string; budget: number; actual_cost: number }) => {
      const budget = parseFloat(String(p.budget)) || 0;
      const actual = parseFloat(String(p.actual_cost)) || 0;
      const margin = budget > 0 ? ((budget - actual) / budget * 100) : 0;
      return { name: p.name, budget, actual, margin };
    }).sort((a: { margin: number }, b: { margin: number }) => b.margin - a.margin).slice(0, 10);

    // 5. KPIs
    const totalRevenue = revenueChart.reduce((s, m) => s + m.revenue, 0);
    const totalExpenses = revenueChart.reduce((s, m) => s + m.expenses, 0);
    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue * 100) : 0;

    // Outstanding invoices
    const { data: unpaid } = await s.from('invoices')
      .select('total')
      .eq('company_id', auth.companyId)
      .eq('status', 'unpaid');
    const outstandingInvoices = (unpaid || []).reduce((sum: number, inv: { total: number }) => sum + (parseFloat(String(inv.total)) || 0), 0);

    // Average payment days
    const { data: paidInvoices } = await s.from('invoices')
      .select('date, due_date, paid_at')
      .eq('company_id', auth.companyId)
      .eq('status', 'paid')
      .order('date', { ascending: false })
      .limit(20);

    let avgPaymentDays = 0;
    if (paidInvoices && paidInvoices.length > 0) {
      const totalDays = (paidInvoices as Array<{ date: string; paid_at?: string }>).reduce((sum, inv) => {
        const paidDate = inv.paid_at ? new Date(inv.paid_at) : new Date();
        const invDate = new Date(inv.date);
        return sum + Math.max(0, (paidDate.getTime() - invDate.getTime()) / 86400000);
      }, 0);
      avgPaymentDays = totalDays / paidInvoices.length;
    }

    return success({
      revenueChart,
      agingReport,
      topClients,
      projectProfitability,
      kpis: {
        totalRevenue,
        totalExpenses,
        netProfit,
        profitMargin,
        outstandingInvoices,
        avgPaymentDays: Math.round(avgPaymentDays),
      },
    }, 200, { cache: 'private', maxAge: 120, staleWhileRevalidate: 60 });
  } catch (err) {
    return handleApiError(err);
  }
}
