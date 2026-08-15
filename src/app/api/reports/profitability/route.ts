import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { sumProjectsJournal } from '@/lib/project-costs';

const number = (value: unknown) => Number(value) || 0;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'financial_reports', 'read');
    const s = getSupabase();
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');
    const { data: projects, error: projectError } = await s.from('projects')
      .select('id, name, contract_value, client_id, status, contacts!client_id(name)')
      .eq('company_id', auth.companyId).order('name');
    if (projectError) throw projectError;
    const projectIds = (projects || []).map((project: any) => project.id);
    const [journalMap, billingResult] = await Promise.all([
      sumProjectsJournal(auth.companyId, projectIds, from, to),
      s.rpc('get_project_billing_totals', {
        p_company_id: auth.companyId, p_project_ids: projectIds, p_from: from, p_to: to,
      }),
    ]);
    if (billingResult.error) throw billingResult.error;
    const billingMap = new Map((billingResult.data || []).map((row: any) => [row.project_id, row]));
    const result = (projects || []).map((project: any) => {
      const contractValue = number(project.contract_value);
      const revenue = journalMap[project.id]?.revenue || 0;
      const totalCosts = journalMap[project.id]?.expenses || 0;
      const profit = revenue - totalCosts;
      return {
        ...project, client_name: project.contacts?.name || null,
        contract_value: contractValue,
        billed_amount: number((billingMap.get(project.id) as any)?.net_billed),
        revenue, total_costs: totalCosts, profit,
        profit_margin: revenue ? (profit / revenue) * 100 : 0,
      };
    });
    const totals = result.reduce((acc, project) => ({
      contract_value: acc.contract_value + project.contract_value,
      billed_amount: acc.billed_amount + project.billed_amount,
      revenue: acc.revenue + project.revenue,
      total_costs: acc.total_costs + project.total_costs,
      profit: acc.profit + project.profit,
    }), { contract_value: 0, billed_amount: 0, revenue: 0, total_costs: 0, profit: 0 });
    return success({ projects: result, totals, period: { from, to }, revenue_source: 'general_ledger' });
  } catch (err) {
    return handleApiError(err);
  }
}
