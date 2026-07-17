import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Cost Center Profitability Report (تقرير ربحية مراكز التكلفة)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const { data: costCenters } = await s.from('cost_centers')
      .select('id, code, name')
      .eq('company_id', auth.companyId)
      .eq('is_active', true)
      .order('code');

    if (!costCenters || costCenters.length === 0) {
      return success({ cost_centers: [], message: 'لا توجد مراكز تكلفة' });
    }

    const result = [];

    for (const cc of costCenters) {
      let entryQuery = s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId)
        .is('deleted_at', null);

      if (from) entryQuery = entryQuery.gte('date', from);
      if (to) entryQuery = entryQuery.lte('date', to);

      const { data: entries } = await entryQuery;
      const entryIds = (entries || []).map((e: any) => e.id);

      let revenue = 0;
      let expenses = 0;

      if (entryIds.length > 0) {
        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit, account_id, accounts!account_id(type)')
          .in('journal_entry_id', entryIds)
          .eq('cost_center_id', cc.id);

        for (const line of lines || []) {
          const accType = (line as any).accounts?.type;
          const debit = parseFloat((line as any).debit) || 0;
          const credit = parseFloat((line as any).credit) || 0;

          if (accType === 'revenue') {
            revenue += credit - debit;
          } else if (accType === 'expense') {
            expenses += debit - credit;
          }
        }
      }

      const profit = revenue - expenses;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      result.push({
        id: cc.id,
        code: cc.code,
        name: cc.name,
        revenue,
        expenses,
        profit,
        profit_margin: margin,
      });
    }

    const totals = {
      total_revenue: result.reduce((sum, cc) => sum + cc.revenue, 0),
      total_expenses: result.reduce((sum, cc) => sum + cc.expenses, 0),
      total_profit: result.reduce((sum, cc) => sum + cc.profit, 0),
    };

    return success({
      cost_centers: result,
      totals: {
        ...totals,
        overall_margin: totals.total_revenue > 0 ? (totals.total_profit / totals.total_revenue) * 100 : 0,
      },
      period: { from, to },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
