import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    
    // Parallelize all queries for better performance
    const [
      revenueResult,
      expenseResult,
      arResult,
      apResult,
      projectsResult,
      overdueInvoicesResult,
      cashResult,
      revenueThisMonth,
      expenseThisMonth
    ] = await Promise.allSettled([
      // Revenue
      s.from('journal_lines')
        .select('credit')
        .eq('company_id', auth.companyId)
        .gte('created_at', new Date(new Date().setDate(1)).toISOString()),
      // Expenses
      s.from('journal_lines')
        .select('debit')
        .eq('company_id', auth.companyId)
        .gte('created_at', new Date(new Date().setDate(1)).toISOString()),
      // Accounts Receivable
      s.from('journal_lines')
        .select('debit, credit')
        .eq('company_id', auth.companyId)
        .gt('debit', 0),
      // Accounts Payable
      s.from('journal_lines')
        .select('credit, debit')
        .eq('company_id', auth.companyId)
        .gt('credit', 0),
      // Projects
      s.from('projects')
        .select('id, name, status, contract_value, start_date, end_date')
        .eq('company_id', auth.companyId),
      // Overdue Invoices
      s.from('invoices')
        .select('id, number, total, due_date, contacts(name)')
        .eq('company_id', auth.companyId)
        .lt('due_date', new Date().toISOString())
        .neq('status', 'paid'),
      // Cash Balance
      s.from('banks_safes')
        .select('type, account_id')
        .eq('company_id', auth.companyId),
      // Revenue this month
      s.from('journal_lines')
        .select('credit')
        .eq('company_id', auth.companyId)
        .gte('created_at', new Date(new Date().setFullYear(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString()),
      // Expense this month
      s.from('journal_lines')
        .select('debit')
        .eq('company_id', auth.companyId)
        .gte('created_at', new Date(new Date().setFullYear(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString()),
    ]);

    // Process results with proper error handling
    const totalRevenue = revenueResult.status === 'fulfilled' && revenueResult.value.data 
      ? revenueResult.value.data.reduce((sum: number, item: any) => sum + (parseFloat(item.credit) || 0), 0)
      : 0;
    
    const totalExpense = expenseResult.status === 'fulfilled' && expenseResult.value.data
      ? expenseResult.value.data.reduce((sum: number, item: any) => sum + (parseFloat(item.debit) || 0), 0)
      : 0;
    
    const accountsReceivable = arResult.status === 'fulfilled' && arResult.value.data
      ? arResult.value.data.reduce((sum: number, item: any) => (parseFloat(item.debit) || 0) - (parseFloat(item.credit) || 0), 0)
      : 0;
    
    const accountsPayable = apResult.status === 'fulfilled' && apResult.value.data
      ? apResult.value.data.reduce((sum: number, item: any) => (parseFloat(item.credit) || 0) - (parseFloat(item.debit) || 0), 0)
      : 0;
    
    const projects = projectsResult.status === 'fulfilled' && projectsResult.value.data
      ? projectsResult.value.data
      : [];
    
    const overdueInvoices = overdueInvoicesResult.status === 'fulfilled' && overdueInvoicesResult.data
      ? overdueInvoices.value.data
      : [];
    
    const cashBalance = cashResult.status === 'fulfilled' && cashResult.value.data
      ? await calculateCashBalance(s, cashResult.value.data)
      : 0;

    const revenueMonth = revenueThisMonth.status === 'fulfilled' && revenueThisMonth.value.data
      ? revenueThisMonth.value.data.reduce((sum: number, item: any) => sum + (parseFloat(item.credit) || 0), 0)
      : 0;

    const expenseMonth = expenseThisMonth.status === 'fulfilled' && expenseThisMonth.value.data
      ? expenseThisMonth.value.data.reduce((sum: number, item: any) => sum + (parseFloat(item.debit) || 0), 0)
      : 0;

    return success({
      totalRevenue,
      totalExpense,
      netProfit: totalRevenue - totalExpense,
      accountsReceivable,
      accountsPayable,
      cashBalance,
      totalProjects: projects.length,
      activeProjects: projects.filter((p: any) => p.status === 'active').length,
      overdueInvoices: overdueInvoices.length,
      overdueAmount: overdueInvoices.reduce((sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0),
      revenueThisMonth: revenueMonth,
      expenseThisMonth: expenseMonth,
      projects: projects.map((p: any) => ({
        ...p,
        progress: calculateProjectProgress(p),
      })),
      recentActivity: await getRecentActivity(s, auth.companyId),
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return serverError(err);
  }
}

async function calculateCashBalance(s: any, banks: any[]): Promise<number> {
  let totalBalance = 0;
  
  for (const bank of banks) {
    if (bank.account_id) {
      try {
        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('account_id', bank.account_id);
        
        if (lines) {
          const debit = lines.reduce((sum: number, item: any) => sum + (parseFloat(item.debit) || 0), 0);
          const credit = lines.reduce((sum: number, item: any) => sum + (parseFloat(item.credit) || 0), 0);
          totalBalance += (debit - credit);
        }
      } catch (err) {
        console.warn(`Failed to calculate balance for bank ${bank.id}:`, err);
      }
    }
  }
  
  return totalBalance;
}

function calculateProjectProgress(project: any): number {
  if (!project.start_date || !project.end_date) return 0;
  
  const now = new Date();
  const start = new Date(project.start_date);
  const end = new Date(project.end_date);
  
  if (now < start) return 0;
  if (now > end) return 100;
  
  const total = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

async function getRecentActivity(s: any, companyId: string): Promise<any[]> {
  try {
    const { data } = await s.from('audit_log')
      .select('action, entity_type, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    return data || [];
  } catch {
    return [];
  }
}