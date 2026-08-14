import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'financial_reports', 'read');
    const s = sb();
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const { data: projects } = await s.from('projects')
      .select('id, name, contract_value, client_id, status, contacts!client_id(name)')
      .eq('company_id', auth.companyId)
      .order('name');

    const { data: expenseAccounts } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('type', 'expense');
    const expAccountIds = new Set((expenseAccounts || []).map((a: any) => a.id));

    const { data: revenueAccounts } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('type', 'revenue');
    const revAccountIds = new Set((revenueAccounts || []).map((a: any) => a.id));

    let invQuery = s.from('invoices')
      .select('id, project_id, total, tax_amount, vat_amount, status')
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled');
    if (from) invQuery = invQuery.gte('date', from);
    if (to) invQuery = invQuery.lte('date', to);
    const { data: invoices } = await invQuery;

    const billedByProject = new Map<string, number>();
    for (const inv of invoices || []) {
      if (!inv.project_id) continue;
      const net = (parseFloat(inv.total) || 0) - (parseFloat(inv.tax_amount || inv.vat_amount) || 0);
      billedByProject.set(inv.project_id, (billedByProject.get(inv.project_id) || 0) + net);
    }

    // Project costs/revenue must use the SAME date window as the invoices.
    // Filtering journal_lines alone has no accounting date and previously made
    // a period profitability report include every historical posting.
    let entryQuery = s.from('journal_entries')
      .select('id')
      .eq('company_id', auth.companyId)
      .is('deleted_at', null);
    if (from) entryQuery = entryQuery.gte('date', from);
    if (to) entryQuery = entryQuery.lte('date', to);
    const { data: periodEntries, error: periodEntriesError } = await entryQuery;
    if (periodEntriesError) throw periodEntriesError;
    const periodEntryIds = (periodEntries || []).map((entry: { id: string }) => entry.id);

    let lines: Array<{ project_id: string | null; account_id: string; debit: number | string; credit: number | string }> = [];
    if (periodEntryIds.length > 0) {
      const { data, error: linesError } = await s.from('journal_lines')
        .select('project_id, account_id, debit, credit')
        .eq('company_id', auth.companyId)
        .in('journal_entry_id', periodEntryIds)
        .not('project_id', 'is', null);
      if (linesError) throw linesError;
      lines = data || [];
    }

    const costByProject = new Map<string, number>();
    const earnedByProject = new Map<string, number>();
    for (const l of lines || []) {
      if (!l.project_id) continue;
      const projectId = String(l.project_id);
      const debit = parseFloat(String(l.debit)) || 0;
      const credit = parseFloat(String(l.credit)) || 0;
      if (expAccountIds.has(l.account_id)) {
        costByProject.set(projectId, (costByProject.get(projectId) || 0) + debit - credit);
      }
      if (revAccountIds.has(l.account_id)) {
        earnedByProject.set(projectId, (earnedByProject.get(projectId) || 0) + credit - debit);
      }
    }

    const result: any[] = [];
    for (const project of (projects || [])) {
      const contractValue = parseFloat(project.contract_value) || 0;
      const billed = billedByProject.get(project.id) || 0;
      const journalRevenue = earnedByProject.get(project.id) || 0;
      const revenue = billed > 0 ? billed : journalRevenue;
      const totalCosts = costByProject.get(project.id) || 0;
      const profit = revenue - totalCosts;
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

      result.push({
        ...project,
        client_name: (project as Record<string, any>).contacts?.name || null,
        contract_value: contractValue,
        billed_amount: billed,
        revenue,
        total_costs: totalCosts,
        profit,
        profit_margin: profitMargin,
      });
    }

    const totals = result.reduce((acc, p) => {
      acc.contract_value += p.contract_value;
      acc.revenue += p.revenue;
      acc.total_costs += p.total_costs;
      acc.profit += p.profit;
      return acc;
    }, { contract_value: 0, revenue: 0, total_costs: 0, profit: 0 });

    return success({ projects: result, totals });
  } catch (err) {
    return handleApiError(err);
  }
}
