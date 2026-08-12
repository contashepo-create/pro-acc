import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
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
    const auth = await requireApiAuth(request);
    const s = sb();

    // Active projects with their contract values.
    const { data: projects, error: pErr } = await s.from('projects')
      .select('id, name, contract_value, status, clients(name)')
      .eq('company_id', auth.companyId)
      .eq('status', 'active');
    if (pErr) throw pErr;

    const projectIds = (projects || []).map((p: any) => p.id);
    let costsByProject: Record<string, number> = {};
    let billedByProject: Record<string, number> = {};

    if (projectIds.length > 0) {
      // Costs: project expenses + equipment costs assigned to the project.
      const [expRes, equipRes, billRes] = await Promise.all([
        s.from('project_expenses').select('project_id, amount').in('project_id', projectIds),
        s.from('equipment_costs').select('project_id, amount').in('project_id', projectIds),
        s.from('invoices').select('project_id, total').eq('company_id', auth.companyId).in('project_id', projectIds),
      ]);

      for (const e of expRes.data || []) costsByProject[e.project_id] = (costsByProject[e.project_id] || 0) + parseFloat(String(e.amount));
      for (const e of equipRes.data || []) costsByProject[e.project_id] = (costsByProject[e.project_id] || 0) + parseFloat(String(e.amount));
      for (const b of billRes.data || []) billedByProject[b.project_id] = (billedByProject[b.project_id] || 0) + parseFloat(String(b.total));
    }

    const rows = (projects || []).map((p: any) => {
      const input: WipInput = {
        contractAmount: parseFloat(String(p.contract_value)) || 0,
        costsIncurred: costsByProject[p.id] || 0,
        billedToDate: billedByProject[p.id] || 0,
      };
      const wip = computeWip(input);
      return {
        project_id: p.id, project_name: p.name, client_name: p.clients?.name || null,
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
