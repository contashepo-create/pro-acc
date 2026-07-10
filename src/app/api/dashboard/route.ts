import { NextRequest } from 'next/server';
import { success, handleApiError } from '@/lib/api-helpers';
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

    // FIXED: Calculate revenue/expenses from journal_lines joined with accounts
    try {
      const { data: accounts } = await s.from('accounts')
        .select('id, type')
        .eq('company_id', companyId)
        .in('type', ['revenue', 'expense']);

      if (accounts && accounts.length > 0) {
        const revenueIds = accounts.filter((a: any) => a.type === 'revenue').map((a: any) => a.id);
        const expenseIds = accounts.filter((a: any) => a.type === 'expense').map((a: any) => a.id);

        if (revenueIds.length > 0) {
          const { data: revLines } = await s.from('journal_lines')
            .select('credit, debit')
            .in('account_id', revenueIds);
          if (revLines) {
            totalRevenue = revLines.reduce((sum: number, l: any) => sum + (parseFloat(l.credit) - parseFloat(l.debit) || 0), 0);
          }
        }

        if (expenseIds.length > 0) {
          const { data: expLines } = await s.from('journal_lines')
            .select('credit, debit')
            .in('account_id', expenseIds);
          if (expLines) {
            totalExpenses = expLines.reduce((sum: number, l: any) => sum + (parseFloat(l.debit) - parseFloat(l.credit) || 0), 0);
          }
        }

        // AR/AP calculation
        const arAccount = accounts.find((a: any) => a.type === 'asset'); // fallback
        // More accurate: get 1130 and 2110 codes
        const { data: arAcc } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', '1130').maybeSingle();
        const { data: apAcc } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', '2110').maybeSingle();
        
        if (arAcc) {
          const { data: arLines } = await s.from('journal_lines').select('debit, credit').eq('account_id', arAcc.id);
          if (arLines) {
            accountsReceivable = arLines.reduce((sum: number, l: any) => sum + (parseFloat(l.debit) - parseFloat(l.credit) || 0), 0);
          }
        }
        if (apAcc) {
          const { data: apLines } = await s.from('journal_lines').select('debit, credit').eq('account_id', apAcc.id);
          if (apLines) {
            accountsPayable = apLines.reduce((sum: number, l: any) => sum + (parseFloat(l.credit) - parseFloat(l.debit) || 0), 0);
          }
        }
      }
    } catch (e) {
      console.error('Dashboard calc error:', e);
    }

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

    // Fallback: try cash table
    if (cashBalance === 0) {
      try {
        const { data: cash } = await s.from('cash_accounts').select('balance').eq('company_id', companyId);
        if (cash) cashBalance = cash.reduce((sum: number, b: any) => sum + (Number(b.balance) || 0), 0);
      } catch {}
    }

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
