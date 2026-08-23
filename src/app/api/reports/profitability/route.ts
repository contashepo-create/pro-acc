import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { sumProjectsJournal } from '@/lib/project-costs';
import { isValidDate } from '@/lib/utils';

import type { Row } from '@/lib/types';

const number = (value: unknown) => Number(value) || 0;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'financial_reports', 'read');
    const s = getSupabase();
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');
    const { data: projects, error: projectError } = await s.rpc('get_report_projects', {
      p_company_id: auth.companyId, p_active_only: false,
    });
    if (projectError) throw projectError;
    const projectIds = ((projects ?? []) as Row[]).map((project: Row) => String(project.project_id));
    const [journalMap, billingResult] = await Promise.all([
      sumProjectsJournal(auth.companyId, projectIds, from, to),
      s.rpc('get_project_billing_totals', {
        p_company_id: auth.companyId, p_project_ids: projectIds, p_from: from, p_to: to,
      }),
    ]);
    if (billingResult.error) throw billingResult.error;
    const billingMap = new Map(((billingResult.data ?? []) as Row[]).map((row: Row) => [String(row.project_id), row]));
    const result = ((projects ?? []) as Row[]).map((project: Row) => {
      const contractValue = number(project.contract_value);
      const revenue = journalMap[String(project.project_id)]?.revenue || 0;
      const totalCosts = journalMap[String(project.project_id)]?.expenses || 0;
      const profit = revenue - totalCosts;
      return {
        id: project.project_id, name: project.name, status: project.status,
        client_id: project.client_id, client_name: project.client_name || null,
        contract_value: contractValue,
        billed_amount: number((billingMap.get(String(project.project_id)) as Row)?.net_billed),
        revenue, total_costs: totalCosts, profit,
        profit_margin: revenue ? (profit / revenue) * 100 : 0,
      };
    });
    const totals = result.reduce((acc: Record<string, number>, project) => ({
      contract_value: acc.contract_value + number(project.contract_value),
      billed_amount: acc.billed_amount + number(project.billed_amount),
      revenue: acc.revenue + number(project.revenue),
      total_costs: acc.total_costs + number(project.total_costs),
      profit: acc.profit + number(project.profit),
    }), { contract_value: 0, billed_amount: 0, revenue: 0, total_costs: 0, profit: 0 });
    return success({ projects: result, totals, period: { from, to }, revenue_source: 'general_ledger' });
  } catch (err) {
    return handleApiError(err);
  }
}
