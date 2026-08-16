import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const amount = (value: unknown) => Number(value) || 0;

/**
 * Posted-ledger financial statements. Aggregation happens in PostgreSQL so the
 * result is not affected by PostgREST row limits; inactive historical accounts
 * remain visible and draft/pending journals are excluded.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'trial_balance';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!['trial_balance', 'income_statement', 'balance_sheet'].includes(type)) return error('نوع التقرير غير صالح');
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) {
      return error('فترة التقرير غير صالحة');
    }

    const { data, error: queryError } = await getSupabase().rpc('get_financial_statement_rows', {
      p_company_id: auth.companyId,
      p_from: from || null,
      p_to: to || null,
    });
    if (queryError) throw queryError;
    const rows = (data || []).map((row: any) => ({
      id: row.account_id,
      code: row.account_code,
      name: row.account_name,
      type: row.account_type,
      openingDebit: amount(row.opening_debit),
      openingCredit: amount(row.opening_credit),
      periodDebit: amount(row.period_debit),
      periodCredit: amount(row.period_credit),
      cumulativeDebit: amount(row.cumulative_debit),
      cumulativeCredit: amount(row.cumulative_credit),
    }));

    if (type === 'trial_balance') {
      const accounts = rows.map((row: any) => {
        const balance = row.cumulativeDebit - row.cumulativeCredit;
        const normalDebit = ['asset', 'expense'].includes(row.type);
        return {
          id: row.id, code: row.code, name: row.name, type: row.type,
          opening_debit: row.openingDebit,
          opening_credit: row.openingCredit,
          total_debit: row.periodDebit,
          total_credit: row.periodCredit,
          balance,
          normal_balance: normalDebit ? (balance >= 0 ? 'debit' : 'credit') : (balance <= 0 ? 'credit' : 'debit'),
        };
      });
      return success({
        accounts,
        total_debit: accounts.reduce((sum: number, row: any) => sum + row.total_debit, 0),
        total_credit: accounts.reduce((sum: number, row: any) => sum + row.total_credit, 0),
      });
    }

    if (type === 'income_statement') {
      const revenue = rows.filter((row: any) => row.type === 'revenue').map((row: any) => ({
        id: row.id, code: row.code, name: row.name, amount: row.periodCredit - row.periodDebit,
      })).filter((row: any) => Math.abs(row.amount) >= 0.005);
      const expenses = rows.filter((row: any) => row.type === 'expense').map((row: any) => ({
        id: row.id, code: row.code, name: row.name, amount: row.periodDebit - row.periodCredit,
      })).filter((row: any) => Math.abs(row.amount) >= 0.005);
      const totalRevenue = revenue.reduce((sum: number, row: any) => sum + row.amount, 0);
      const totalExpenses = expenses.reduce((sum: number, row: any) => sum + row.amount, 0);
      return success({
        revenue, expenses,
        total_revenue: totalRevenue,
        total_expenses: totalExpenses,
        net_income: totalRevenue - totalExpenses,
      });
    }

    const assets = rows.filter((row: any) => row.type === 'asset').map((row: any) => ({
      id: row.id, code: row.code, name: row.name, balance: row.cumulativeDebit - row.cumulativeCredit,
    })).filter((row: any) => Math.abs(row.balance) >= 0.005);
    const liabilities = rows.filter((row: any) => row.type === 'liability').map((row: any) => ({
      id: row.id, code: row.code, name: row.name, balance: row.cumulativeCredit - row.cumulativeDebit,
    })).filter((row: any) => Math.abs(row.balance) >= 0.005);
    const equity = rows.filter((row: any) => row.type === 'equity').map((row: any) => ({
      id: row.id, code: row.code, name: row.name, balance: row.cumulativeCredit - row.cumulativeDebit,
    })).filter((row: any) => Math.abs(row.balance) >= 0.005);
    const cumulativeRevenue = rows.filter((row: any) => row.type === 'revenue')
      .reduce((sum: number, row: any) => sum + row.cumulativeCredit - row.cumulativeDebit, 0);
    const cumulativeExpenses = rows.filter((row: any) => row.type === 'expense')
      .reduce((sum: number, row: any) => sum + row.cumulativeDebit - row.cumulativeCredit, 0);
    const equityWithNetIncome = [...equity, {
      id: 'virtual-current-year-net-income', code: '3300-V',
      name: 'الأرباح (الخسائر) المتراكمة حتى تاريخ التقرير',
      balance: cumulativeRevenue - cumulativeExpenses,
    }];
    return success({
      assets, liabilities, equity: equityWithNetIncome,
      total_assets: assets.reduce((sum: number, row: any) => sum + row.balance, 0),
      total_liabilities: liabilities.reduce((sum: number, row: any) => sum + row.balance, 0),
      total_equity: equityWithNetIncome.reduce((sum: number, row: any) => sum + row.balance, 0),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
