import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError, error, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Project Profit & Loss (أرباح وخسائر كل مشروع لوحده)
 * Shows revenue, costs, profit per project
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'financial_reports', 'read');
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

      const { sumProjectJournal } = await import('@/lib/project-costs');
      const journal = await sumProjectJournal(auth.companyId, projectId);

      const costs = {
        materials: 0,
        labor: 0,
        subcontractors: 0,
        equipment: 0,
        other: 0,
        total: journal.expenses,
      };
      for (const acc of journal.accounts) {
        if (acc.type !== 'expense') continue;
        const net = acc.debit - acc.credit;
        const code = acc.code || '';
        if (code.startsWith('511')) costs.materials += net;
        else if (code.startsWith('521') || code.startsWith('522')) costs.labor += net;
        else if (code.startsWith('215') || code.startsWith('513')) costs.subcontractors += net;
        else if (code.startsWith('512') || code.startsWith('52')) costs.equipment += net;
        else costs.other += net;
      }

      let revenue = journal.revenue;
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

      // Subtract credit notes from revenue
      let creditNoteTotal = 0;
      try {
        const { data: creditNotes } = await s.from('credit_notes')
          .select('total')
          .eq('company_id', auth.companyId)
          .eq('project_id', projectId)
          .neq('status', 'cancelled');
        creditNoteTotal = (creditNotes || []).reduce((sum: number, cn: any) => sum + (parseFloat(cn.total) || 0), 0);
      } catch {}

      const netInvoiceRevenue = invoiceRevenue - creditNoteTotal;

      // If no journal revenue, use net invoices
      if (revenue === 0 && netInvoiceRevenue > 0) {
        revenue = netInvoiceRevenue;
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
          invoice_revenue: netInvoiceRevenue,
          credit_notes: creditNoteTotal,
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
          .select('total, subtotal, tax_amount, vat_amount')
          .eq('company_id', auth.companyId)
          .eq('project_id', p.id)
          .neq('status', 'cancelled');

        const revenue = (invoices || []).reduce((sum: number, inv: any) => {
          const net = parseFloat(inv.subtotal) || ((parseFloat(inv.total) || 0) - (parseFloat(inv.tax_amount || inv.vat_amount) || 0));
          return sum + net;
        }, 0);

        const { sumProjectJournal } = await import('@/lib/project-costs');
        const journal = await sumProjectJournal(auth.companyId, p.id);
        const costs = journal.expenses;

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
