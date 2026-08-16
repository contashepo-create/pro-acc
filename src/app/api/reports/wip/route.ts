import { NextRequest } from 'next/server';
import { success, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { computeWip, type WipInput } from '@/lib/construction';

const sb = () => getSupabase();

/**
 * GET /api/reports/wip — Work In Progress across active projects.
 * For each project: % complete, earned revenue, over/under-billing,
 * cost to complete, estimated profit.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'financial_reports', 'read');
    const s = sb();

    const { data: projects, error: projectsError } = await s.rpc('get_report_projects', {
      p_company_id: auth.companyId, p_active_only: true,
    });
    if (projectsError) throw projectsError;
    const projectIds = (projects || []).map((project: any) => project.project_id);
    let costsByProject: Record<string, number> = {};
    let billedByProject: Record<string, number> = {};

    if (projectIds.length > 0) {
      const { sumProjectsJournal } = await import('@/lib/project-costs');
      const [journalMap, billingResult] = await Promise.all([
        sumProjectsJournal(auth.companyId, projectIds),
        s.rpc('get_project_billing_totals', {
          p_company_id: auth.companyId, p_project_ids: projectIds, p_from: null, p_to: null,
        }),
      ]);
      if (billingResult.error) throw billingResult.error;
      for (const id of projectIds) costsByProject[id] = journalMap[id]?.expenses || 0;
      for (const row of billingResult.data || []) billedByProject[row.project_id] = parseFloat(String(row.net_billed)) || 0;
    }

    const rows = (projects || []).map((p: any) => {
      const input: WipInput = {
        contractAmount: parseFloat(String(p.contract_value)) || 0,
        costsIncurred: costsByProject[p.project_id] || 0,
        billedToDate: billedByProject[p.project_id] || 0,
      };
      const wip = computeWip(input);
      return {
        project_id: p.project_id, project_name: p.name, client_name: p.client_name || null,
        contract_amount: input.contractAmount, costs_incurred: input.costsIncurred,
        billed_to_date: input.billedToDate, ...wip,
      };
    });

    // Totals
    const totals = rows.reduce((acc, r) => {
      acc.contract += r.contract_amount;
      acc.costs += r.costs_incurred;
      acc.billed += r.billed_to_date;
      acc.overUnderBilled += r.overUnderBilled;
      return acc;
    }, { contract: 0, costs: 0, billed: 0, overUnderBilled: 0 });

    return success({ rows, totals });
  } catch (err) {
    return handleApiError(err);
  }
}
