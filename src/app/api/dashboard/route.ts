import { NextRequest } from 'next/server';
import { success, error, handleApiError } from '@/lib/api-helpers';
import { requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const s = sb();

    let totalRevenue = 0, totalExpenses = 0, accountsReceivable = 0, accountsPayable = 0;
    let cashBalance = 0, activeProjects = 0, overdueInvoices = 0;

    try {
      const { data: rev } = await s.from('journal_entries').select('total_credit, total_debit')
        .eq('company_id', companyId).eq('type', 'general');
      if (rev) {
        const revAccount = rev.find((r: any) => r.total_credit > 0);
        totalRevenue = rev ? rev.reduce((sum: number, r: any) => sum + (Number(r.total_credit) || 0), 0) : 0;
        totalExpenses = rev ? rev.reduce((sum: number, r: any) => sum + (Number(r.total_debit) || 0), 0) : 0;
      }
    } catch {}

    try {
      const { count } = await s.from('projects').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('status', 'active');
      activeProjects = count || 0;
    } catch {}

    try {
      const today = new Date().toISOString().split('T')[0];
      const { count } = await s.from('invoices').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).lt('due_date', today).neq('status', 'paid');
      overdueInvoices = count || 0;
    } catch {}

    try {
      const { data: banks } = await s.from('banks_safes').select('balance')
        .eq('company_id', companyId).eq('is_active', true);
      if (banks) cashBalance = banks.reduce((sum: number, b: any) => sum + (Number(b.balance) || 0), 0);
    } catch {}

    return success({
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      net_profit: totalRevenue - totalExpenses,
      accounts_receivable: accountsReceivable,
      accounts_payable: accountsPayable,
      cash_balance: cashBalance,
      active_projects: activeProjects,
      overdue_invoices: overdueInvoices,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
