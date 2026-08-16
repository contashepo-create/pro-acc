import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const number = (value: unknown) => Number(value) || 0;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'financial_reports', 'read');
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');
    const { data, error: queryError } = await getSupabase().rpc('get_cost_center_profitability', {
      p_company_id: auth.companyId, p_from: from, p_to: to,
    });
    if (queryError) throw queryError;
    const costCenters = (data || []).map((row: any) => {
      const revenue = number(row.revenue);
      const expenses = number(row.expenses);
      const profit = revenue - expenses;
      return {
        id: row.cost_center_id, code: row.code, name: row.name,
        revenue, expenses, profit, profit_margin: revenue ? (profit / revenue) * 100 : 0,
      };
    });
    const totalRevenue = costCenters.reduce((sum, row) => sum + row.revenue, 0);
    const totalExpenses = costCenters.reduce((sum, row) => sum + row.expenses, 0);
    const totalProfit = totalRevenue - totalExpenses;
    return success({
      cost_centers: costCenters, available: true,
      totals: {
        total_revenue: totalRevenue, total_expenses: totalExpenses, total_profit: totalProfit,
        overall_margin: totalRevenue ? (totalProfit / totalRevenue) * 100 : 0,
      },
      period: { from, to },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
