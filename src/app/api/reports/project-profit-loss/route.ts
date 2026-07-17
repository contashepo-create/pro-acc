import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError, error } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Project Profit & Loss (أرباح وخسائر كل مشروع لوحده)
 * Shows revenue, costs, profit per project
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    if (projectId) {
      // Single project P&L
      const { data: project, error: projErr } = await s.from('projects')
        .select('id, name, contract_value, client_id, contacts!client_id(name), status, start_date, end_date')
        .eq('id', projectId)
        .eq('company_id', auth.companyId)
        .single();

      if (projErr || !project) return error('المشروع غير موجود', 404);

      const p: any = project;

      // Get all journal entries for this project
      let jeQuery = s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId)
        .is('deleted_at', null);

      if (from) jeQuery = jeQuery.gte('date', from);
      if (to) jeQuery = jeQuery.lte('date', to);

      const { data: entries } = await jeQuery;
      const entryIds = (entries || []).map((e: any) => e.id);

      let revenue = 0;
      let costs = {
        materials: 0,
        labor: 0,
        subcontractors: 0,
        equipment: 0,
        other: 0,
        total: 0,
      };

      if (entryIds.length > 0) {
        // Get all lines for these entries
        const { data: lines } = await s.from('journal_lines')
          .select('account_id, debit, credit, accounts(code, name, type)')
          .in('journal_entry_id', entryIds);

        for (const line of lines || []) {
          const acc: any = (line as any).accounts;
          const debit = parseFloat((line as any).debit) || 0;
          const credit = parseFloat((line as any).credit) || 0;

          if (acc?.type === 'revenue') {
            revenue += credit - debit;
          } else if (acc?.type === 'expense') {
            const code = acc.code || '';
            if (code.startsWith('511') || code === '5110') costs.materials += debit - credit;
            else if (code.startsWith('521') || code === '5210') costs.labor += debit - credit;
            else if (code.startsWith('215') || code === '2150') costs.subcontractors += debit - credit;
            else if (code.startsWith('124') || code.startsWith('123')) costs.equipment += debit - credit;
            else costs.other += debit - credit;

            costs.total += debit - credit;
          }
        }
      }

      // Also include invoices for this project as revenue
      let invoiceQuery = s.from('invoices')
        .select('total, status')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId)
        .neq('status', 'cancelled')
        .is('deleted_at', null);

      if (from) invoiceQuery = invoiceQuery.gte('date', from);
      if (to) invoiceQuery = invoiceQuery.lte('date', to);

      const { data: invoices } = await invoiceQuery;
      const invoiceRevenue = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0);

      // If no journal revenue, use invoices
      if (revenue === 0 && invoiceRevenue > 0) {
        revenue = invoiceRevenue;
      }

      const profit = revenue - costs.total;
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const contractValue = parseFloat(p.contract_value) || 0;
      const completionPercent = contractValue > 0 ? (revenue / contractValue) * 100 : 0;

      return success({
        project: {
          id: p.id,
          name: p.name,
          client_name: p.contacts?.name || null,
          contract_value: contractValue,
          status: p.status,
          start_date: p.start_date,
          end_date: p.end_date,
        },
        financials: {
          revenue,
          invoice_revenue: invoiceRevenue,
          costs,
          profit,
          profit_margin: profitMargin,
          contract_value: contractValue,
          completion_percent: completionPercent,
          remaining_value: contractValue - revenue,
        },
        summary: {
          total_revenue: revenue,
          total_costs: costs.total,
          net_profit: profit,
          profit_margin: profitMargin,
        }
      });
    } else {
      // All projects P&L (like profitability but with more details)
      const { data: projects } = await s.from('projects')
        .select('id, name, contract_value, client_id, contacts!client_id(name), status')
        .eq('company_id', auth.companyId)
        .order('name');

      const result = [];

      for (const project of projects || []) {
        const p: any = project;
        const contractValue = parseFloat(p.contract_value) || 0;

        // Get invoices revenue
        const { data: invoices } = await s.from('invoices')
          .select('total')
          .eq('company_id', auth.companyId)
          .eq('project_id', p.id)
          .neq('status', 'cancelled')
          .is('deleted_at', null);

        const revenue = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0);

        // Get costs from journal
        const { data: entries } = await s.from('journal_entries')
          .select('id')
          .eq('company_id', auth.companyId)
          .eq('project_id', p.id)
          .is('deleted_at', null);

        const entryIds = (entries || []).map((e: any) => e.id);
        let costs = 0;

        if (entryIds.length > 0) {
          const { data: expenseAccounts } = await s.from('accounts')
            .select('id')
            .eq('company_id', auth.companyId)
            .eq('type', 'expense');

          const expIds = (expenseAccounts || []).map((a: any) => a.id);

          if (expIds.length > 0) {
            const { data: lines } = await s.from('journal_lines')
              .select('debit')
              .in('account_id', expIds)
              .in('journal_entry_id', entryIds);

            costs = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
          }
        }

        const profit = revenue - costs;
        const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

        result.push({
          id: p.id,
          name: p.name,
          client_name: p.contacts?.name || null,
          contract_value: contractValue,
          revenue,
          costs,
          profit,
          profit_margin: profitMargin,
          status: p.status,
        });
      }

      const totalContract = result.reduce((sum, p) => sum + p.contract_value, 0);
      const totalRevenue = result.reduce((sum, p) => sum + p.revenue, 0);
      const totalCosts = result.reduce((sum, p) => sum + p.costs, 0);
      const totalProfit = result.reduce((sum, p) => sum + p.profit, 0);

      return success({
        projects: result,
        totals: {
          total_contract_value: totalContract,
          total_revenue: totalRevenue,
          total_costs: totalCosts,
          total_profit: totalProfit,
          overall_margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
        }
      });
    }
  } catch (err) {
    return handleApiError(err);
  }
}
