import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { sumProjectJournal, sumProjectsJournal } from '@/lib/project-costs';
import { deliveryDate, deliveryUuid } from '@/lib/project-delivery-validation';

const number = (value: unknown) => Number(value) || 0;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'financial_reports', 'read');
    const s = getSupabase();
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (projectId && !deliveryUuid.safeParse(projectId).success) return error('معرّف المشروع غير صالح');
    if ((from && !deliveryDate.safeParse(from).success) || (to && !deliveryDate.safeParse(to).success) || (from && to && from > to)) return error('فترة التقرير غير صالحة');

    if (projectId) {
      const { data: project, error: projectError } = await s.from('projects')
        .select('id, name, contract_value, client_id, contacts!client_id(name), status, start_date, end_date')
        .eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
      if (projectError) throw projectError;
      if (!project) return error('المشروع غير موجود', 404);
      const [journal, billingResult] = await Promise.all([
        sumProjectJournal(auth.companyId, projectId, from, to),
        s.rpc('get_project_billing_totals', {
          p_company_id: auth.companyId, p_project_ids: [projectId], p_from: from, p_to: to,
        }),
      ]);
      if (billingResult.error) throw billingResult.error;
      const billing = billingResult.data?.[0] || {};
      const costs = { materials: 0, labor: 0, subcontractors: 0, equipment: 0, other: 0, total: journal.expenses };
      for (const account of journal.accounts) {
        if (account.type !== 'expense') continue;
        const net = account.debit - account.credit;
        if (account.code.startsWith('511')) costs.materials += net;
        else if (account.code.startsWith('521') || account.code.startsWith('522')) costs.labor += net;
        else if (account.code.startsWith('513')) costs.subcontractors += net;
        else if (account.code.startsWith('512')) costs.equipment += net;
        else costs.other += net;
      }
      const revenue = journal.revenue;
      const profit = revenue - costs.total;
      const contractValue = number((project as any).contract_value);
      return success({
        project: {
          id: project.id, name: project.name, client_name: (project as any).contacts?.name || null,
          contract_value: contractValue, status: project.status,
          start_date: (project as any).start_date, end_date: (project as any).end_date,
        },
        financials: {
          revenue, invoice_revenue: number(billing.net_billed), credit_notes: number(billing.credits),
          costs, profit, profit_margin: revenue ? (profit / revenue) * 100 : 0,
          contract_value: contractValue,
          completion_percent: contractValue ? (revenue / contractValue) * 100 : 0,
          remaining_value: contractValue - revenue,
        },
        summary: { total_revenue: revenue, total_costs: costs.total, net_profit: profit, profit_margin: revenue ? (profit / revenue) * 100 : 0 },
        period: { from, to }, revenue_source: 'general_ledger',
      });
    }

    const { data: projects, error: projectsError } = await s.rpc('get_report_projects', {
      p_company_id: auth.companyId, p_active_only: false,
    });
    if (projectsError) throw projectsError;
    const projectIds = (projects || []).map((project: any) => project.project_id);
    const [journalMap, billingResult] = await Promise.all([
      sumProjectsJournal(auth.companyId, projectIds, from, to),
      s.rpc('get_project_billing_totals', { p_company_id: auth.companyId, p_project_ids: projectIds, p_from: from, p_to: to }),
    ]);
    if (billingResult.error) throw billingResult.error;
    const billingMap = new Map((billingResult.data || []).map((row: any) => [row.project_id, row]));
    const result = (projects || []).map((project: any) => {
      const contractValue = number(project.contract_value);
      const revenue = journalMap[project.project_id]?.revenue || 0;
      const costs = journalMap[project.project_id]?.expenses || 0;
      const profit = revenue - costs;
      return {
        id: project.project_id, name: project.name, client_name: project.client_name || null,
        contract_value: contractValue, billed_amount: number((billingMap.get(project.project_id) as any)?.net_billed),
        revenue, costs, profit, profit_margin: revenue ? (profit / revenue) * 100 : 0, status: project.status,
      };
    });
    const totals = result.reduce((acc: Record<string, number>, project: Record<string, number>) => ({
      total_contract_value: acc.total_contract_value + project.contract_value,
      total_billed: acc.total_billed + project.billed_amount,
      total_revenue: acc.total_revenue + project.revenue,
      total_costs: acc.total_costs + project.costs,
      total_profit: acc.total_profit + project.profit,
    }), { total_contract_value: 0, total_billed: 0, total_revenue: 0, total_costs: 0, total_profit: 0 });
    return success({
      projects: result,
      totals: { ...totals, overall_margin: totals.total_revenue ? (totals.total_profit / totals.total_revenue) * 100 : 0 },
      period: { from, to }, revenue_source: 'general_ledger',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
