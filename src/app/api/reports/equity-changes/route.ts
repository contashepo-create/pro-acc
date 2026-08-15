import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const number = (value: unknown) => Number(value) || 0;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');
    const { data, error: queryError } = await getSupabase().rpc('get_equity_changes_summary', {
      p_company_id: auth.companyId, p_from: from, p_to: to,
    });
    if (queryError) throw queryError;
    const values = (data || {}) as Record<string, unknown>;
    const openingCapital = number(values.openingCapital);
    const openingRetained = number(values.openingRetained);
    const openingOtherEquity = number(values.openingOtherEquity);
    const openingPriorNetIncome = number(values.openingPriorNetIncome);
    const periodCapitalChange = number(values.periodCapitalChange);
    const periodRetainedChange = number(values.periodRetainedChange);
    const periodNetIncome = number(values.periodRevenue) - number(values.periodExpenses);
    const openingRetainedWithIncome = openingRetained + openingPriorNetIncome;
    const openingTotal = openingCapital + openingRetainedWithIncome + openingOtherEquity;
    const endingCapital = openingCapital + periodCapitalChange;
    const endingRetained = openingRetainedWithIncome + periodRetainedChange;
    const endingTotal = endingCapital + endingRetained + openingOtherEquity + periodNetIncome;
    return success({
      period: { from, to },
      opening: { capital: openingCapital, retained_earnings: openingRetainedWithIncome, other_equity: openingOtherEquity, net_income: 0, total: openingTotal },
      changes: {
        capital_contributions: periodCapitalChange, retained_earnings_transfers: periodRetainedChange,
        net_income: periodNetIncome, total_change: periodCapitalChange + periodRetainedChange + periodNetIncome,
      },
      ending: { capital: endingCapital, retained_earnings: endingRetained, other_equity: openingOtherEquity, net_income: periodNetIncome, total: endingTotal },
      rows: [
        { label: 'رصيد بداية الفترة', capital: openingCapital, retained_earnings: openingRetainedWithIncome, net_income: 0, total: openingTotal },
        { label: 'صافي ربح / (خسارة) الفترة', capital: 0, retained_earnings: 0, net_income: periodNetIncome, total: periodNetIncome },
        { label: 'تغيرات رأس المال', capital: periodCapitalChange, retained_earnings: 0, net_income: 0, total: periodCapitalChange },
        { label: 'تحويلات وتوزيعات الأرباح', capital: 0, retained_earnings: periodRetainedChange, net_income: 0, total: periodRetainedChange },
        { label: 'رصيد نهاية الفترة', capital: endingCapital, retained_earnings: endingRetained, net_income: periodNetIncome, total: endingTotal },
      ],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
