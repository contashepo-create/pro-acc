import { NextRequest } from 'next/server';
import { success, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const number = (value: unknown) => Number(value) || 0;

/** Advanced analytics sourced from posted ledger dates and authoritative balances. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const today = now.toISOString().split('T')[0];
    const from = `${currentYear}-01-01`;
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

    const [monthlyResult, agingResult, clientsResult, projectsResult, invoiceKpisResult] = await Promise.all([
      s.rpc('get_monthly_profit_loss', { p_company_id: auth.companyId, p_year: currentYear }),
      s.rpc('get_receivable_aging', { p_company_id: auth.companyId, p_as_of: today }),
      s.rpc('get_top_clients_by_revenue', {
        p_company_id: auth.companyId, p_from: from, p_to: today, p_limit: 5,
      }),
      s.rpc('get_project_profitability', { p_company_id: auth.companyId, p_limit: 10 }),
      s.rpc('get_invoice_kpis', { p_company_id: auth.companyId }),
    ]);
    for (const result of [monthlyResult, agingResult, clientsResult, projectsResult, invoiceKpisResult]) {
      if (result.error) throw result.error;
    }

    const revenueChart = (monthlyResult.data || []).map((row: any) => ({
      month: months[number(row.month_number) - 1], revenue: number(row.revenue), expenses: number(row.expenses),
    }));
    const agingReport = (agingResult.data || []).map((row: any) => ({
      range: row.bucket, count: number(row.invoice_count), amount: number(row.amount),
    }));
    const topClients = (clientsResult.data || []).map((row: any) => ({
      name: row.name, revenue: number(row.revenue), count: number(row.entry_count),
    }));
    const projectProfitability = (projectsResult.data || []).map((row: any) => ({
      name: row.name, revenue: number(row.revenue), expenses: number(row.expenses), margin: number(row.margin),
    }));
    const totalRevenue = revenueChart.reduce((sum: number, row: any) => sum + row.revenue, 0);
    const totalExpenses = revenueChart.reduce((sum: number, row: any) => sum + row.expenses, 0);
    const netProfit = totalRevenue - totalExpenses;
    const invoiceKpis = (invoiceKpisResult.data || {}) as Record<string, unknown>;

    return success({
      revenueChart, agingReport, topClients, projectProfitability,
      kpis: {
        totalRevenue, totalExpenses, netProfit,
        profitMargin: totalRevenue ? (netProfit / totalRevenue) * 100 : 0,
        outstandingInvoices: number(invoiceKpis.outstanding),
        avgPaymentDays: Math.round(number(invoiceKpis.avgPaymentDays)),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
