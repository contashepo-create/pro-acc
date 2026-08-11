import { NextRequest } from 'next/server';
import { success, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Statement of Changes in Equity (قائمة التغيرات في حقوق الملكية)
 * One of the 4 primary IFRS/GAAP/SOCPA financial statements.
 * Tracks changes in:
 * - Capital (رأس المال - 3100)
 * - Retained Earnings (الأرباح المحتجزة - 3200)
 * - Current Year Net Income (صافي دخل الفترة - 3300)
 * - Total Equity (إجمالي حقوق الملكية)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // 1. Get equity accounts
    const { data: equityAccounts } = await s.from('accounts')
      .select('id, code, name')
      .eq('company_id', auth.companyId)
      .eq('type', 'equity');

    const equityIds = (equityAccounts || []).map((a: any) => a.id);

    // 2. Get revenue and expense accounts to compute Net Income
    const { data: revExpAccounts } = await s.from('accounts')
      .select('id, type')
      .eq('company_id', auth.companyId)
      .in('type', ['revenue', 'expense']);

    const revIds = new Set((revExpAccounts || []).filter((a: any) => a.type === 'revenue').map((a: any) => a.id));
    const expIds = new Set((revExpAccounts || []).filter((a: any) => a.type === 'expense').map((a: any) => a.id));

    // 3. Opening Balances (before 'from' date)
    let openingCapital = 0;
    let openingRetained = 0;
    let openingOtherEquity = 0;
    let openingPriorNetIncome = 0;

    if (from) {
      const { data: priorJEs } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId)
        .lt('date', from)
        .is('deleted_at', null);

      const priorJeIds = (priorJEs || []).map((j: any) => j.id);

      if (priorJeIds.length > 0) {
        const { data: priorLines } = await s.from('journal_lines')
          .select('account_id, debit, credit')
          .eq('company_id', auth.companyId)
          .in('journal_entry_id', priorJeIds);

        for (const l of priorLines || []) {
          const debit = parseFloat(l.debit) || 0;
          const credit = parseFloat(l.credit) || 0;
          const netCredit = credit - debit;

          const acc = (equityAccounts || []).find((a: any) => a.id === l.account_id);
          if (acc) {
            if (acc.code === '3100') openingCapital += netCredit;
            else if (acc.code === '3200') openingRetained += netCredit;
            else openingOtherEquity += netCredit;
          }

          if (revIds.has(l.account_id)) openingPriorNetIncome += netCredit;
          if (expIds.has(l.account_id)) openingPriorNetIncome -= (debit - credit);
        }
      }
    }

    // 4. Period Transactions (between 'from' and 'to')
    let jeQuery = s.from('journal_entries')
      .select('id, date, type')
      .eq('company_id', auth.companyId)
      .is('deleted_at', null);

    if (from) jeQuery = jeQuery.gte('date', from);
    if (to) jeQuery = jeQuery.lte('date', to);

    const { data: periodJEs } = await jeQuery;
    const periodJeIds = (periodJEs || []).map((j: any) => j.id);

    let periodCapitalChange = 0;
    let periodRetainedChange = 0;
    let periodRevenue = 0;
    let periodExpenses = 0;

    if (periodJeIds.length > 0) {
      const { data: periodLines } = await s.from('journal_lines')
        .select('account_id, debit, credit')
        .eq('company_id', auth.companyId)
        .in('journal_entry_id', periodJeIds);

      for (const l of periodLines || []) {
        const debit = parseFloat(l.debit) || 0;
        const credit = parseFloat(l.credit) || 0;
        const netCredit = credit - debit;

        const acc = (equityAccounts || []).find((a: any) => a.id === l.account_id);
        if (acc) {
          if (acc.code === '3100') periodCapitalChange += netCredit;
          else if (acc.code === '3200') periodRetainedChange += netCredit;
        }

        if (revIds.has(l.account_id)) periodRevenue += netCredit;
        if (expIds.has(l.account_id)) periodExpenses += (debit - credit);
      }
    }

    const periodNetIncome = periodRevenue - periodExpenses;

    const openingTotal = openingCapital + openingRetained + openingOtherEquity + openingPriorNetIncome;
    const endingCapital = openingCapital + periodCapitalChange;
    const endingRetained = openingRetained + openingPriorNetIncome + periodRetainedChange;
    const endingNetIncome = periodNetIncome;
    const endingTotal = endingCapital + endingRetained + endingNetIncome + openingOtherEquity;

    return success({
      period: { from, to },
      opening: {
        capital: openingCapital,
        retained_earnings: openingRetained + openingPriorNetIncome,
        net_income: 0,
        total: openingTotal,
      },
      changes: {
        capital_contributions: periodCapitalChange,
        retained_earnings_transfers: periodRetainedChange,
        net_income: periodNetIncome,
        total_change: periodCapitalChange + periodRetainedChange + periodNetIncome,
      },
      ending: {
        capital: endingCapital,
        retained_earnings: endingRetained,
        net_income: endingNetIncome,
        total: endingTotal,
      },
      rows: [
        {
          label: 'رصيد بداية الفترة',
          capital: openingCapital,
          retained_earnings: openingRetained + openingPriorNetIncome,
          net_income: 0,
          total: openingTotal,
        },
        {
          label: 'صافي ربح / (خسارة) الفترة',
          capital: 0,
          retained_earnings: 0,
          net_income: periodNetIncome,
          total: periodNetIncome,
        },
        {
          label: 'تغيرات رأس المال',
          capital: periodCapitalChange,
          retained_earnings: 0,
          net_income: 0,
          total: periodCapitalChange,
        },
        {
          label: 'تحويلات وتوزيعات الأرباح',
          capital: 0,
          retained_earnings: periodRetainedChange,
          net_income: 0,
          total: periodRetainedChange,
        },
        {
          label: 'رصيد نهاية الفترة',
          capital: endingCapital,
          retained_earnings: endingRetained,
          net_income: endingNetIncome,
          total: endingTotal,
        },
      ],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
