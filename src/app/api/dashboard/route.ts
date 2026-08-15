import { NextRequest } from 'next/server';
import { success, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const amount = (value: unknown) => Number(value) || 0;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const monthStart = `${today.slice(0, 7)}-01`;

    const [allSummary, monthSummary, projectsResult, overdueResult, activityResult] = await Promise.all([
      s.rpc('get_financial_summary', { p_company_id: auth.companyId, p_from: null, p_to: today }),
      s.rpc('get_financial_summary', { p_company_id: auth.companyId, p_from: monthStart, p_to: today }),
      s.from('projects').select('id, name, status, contract_value, start_date, end_date')
        .eq('company_id', auth.companyId),
      s.from('invoices').select('id, number, total, paid_amount, due_date, contacts(name)')
        .eq('company_id', auth.companyId).lt('due_date', today).in('status', ['unpaid', 'partial']),
      s.from('audit_log').select('action, entity_type, created_at')
        .eq('company_id', auth.companyId).order('created_at', { ascending: false }).limit(10),
    ]);

    for (const result of [allSummary, monthSummary, projectsResult, overdueResult, activityResult]) {
      if (result.error) throw result.error;
    }
    const ledger = (allSummary.data || {}) as Record<string, unknown>;
    const month = (monthSummary.data || {}) as Record<string, unknown>;
    const projects = projectsResult.data || [];
    const overdueInvoices = overdueResult.data || [];
    const totalRevenue = amount(ledger.revenue);
    const totalExpense = amount(ledger.expenses);

    return success({
      totalRevenue,
      totalExpense,
      netProfit: totalRevenue - totalExpense,
      accountsReceivable: amount(ledger.accountsReceivable),
      accountsPayable: amount(ledger.accountsPayable),
      cashBalance: amount(ledger.cashBalance),
      totalProjects: projects.length,
      activeProjects: projects.filter((project: any) => project.status === 'active').length,
      overdueInvoices: overdueInvoices.length,
      overdueAmount: overdueInvoices.reduce(
        (sum: number, invoice: any) => sum + Math.max(0, amount(invoice.total) - amount(invoice.paid_amount)), 0,
      ),
      revenueThisMonth: amount(month.revenue),
      expenseThisMonth: amount(month.expenses),
      projects: projects.map((project: any) => ({ ...project, progress: calculateProjectProgress(project) })),
      recentActivity: activityResult.data || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function calculateProjectProgress(project: any): number {
  if (!project.start_date || !project.end_date) return 0;
  const now = Date.now();
  const start = Date.parse(project.start_date);
  const end = Date.parse(project.end_date);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return now >= end ? 100 : 0;
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}
