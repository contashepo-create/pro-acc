import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();

    const { data: projects } = await s.from('projects')
      .select('id, name, contract_value, client_id, status, contacts!client_id(name)')
      .eq('company_id', auth.companyId)
      .order('name');

    const result: any[] = [];
    for (const project of (projects || [])) {
      // Get project costs from journal_lines linked via project_id in journal_entries
      const { data: jeIds } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId)
        .or(`project_id.eq.${project.id}`);

      const jeIdList = (jeIds || []).map((je: any) => je.id);

      let totalCosts = 0;
      if (jeIdList.length > 0) {
        // Get expense account IDs
        const { data: expenseAccounts } = await s.from('accounts')
          .select('id')
          .eq('company_id', auth.companyId)
          .eq('type', 'expense');

        const expAccountIds = (expenseAccounts || []).map((a: any) => a.id);

        if (expAccountIds.length > 0) {
          const { data: lines } = await s.from('journal_lines')
            .select('debit')
            .in('account_id', expAccountIds)
            .in('journal_entry_id', jeIdList);

          totalCosts = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
        }
      }

      const contractValue = parseFloat(project.contract_value) || 0;
      const profit = contractValue - totalCosts;
      const profitMargin = contractValue > 0 ? (profit / contractValue) * 100 : 0;

      result.push({
        ...project,
        client_name: (project as any).contacts?.name || null,
        contract_value: contractValue,
        total_costs: totalCosts,
        profit,
        profit_margin: profitMargin,
      });
    }

    return success({ projects: result });
  } catch (err) {
    return handleApiError(err);
  }
}
