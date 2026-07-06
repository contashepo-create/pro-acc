import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'trial_balance';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    if (type === 'trial_balance') {
      const accounts = await query(
        `SELECT a.id, a.code, a.name, a.type,
          COALESCE(SUM(jl.debit), 0) as total_debit,
          COALESCE(SUM(jl.credit), 0) as total_credit,
          COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as balance
         FROM accounts a
         LEFT JOIN journal_lines jl ON a.id = jl.account_id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
           AND ($2::date IS NULL OR je.date >= $2)
           AND ($3::date IS NULL OR je.date <= $3)
         WHERE a.company_id = $1 AND a.is_active = true
         GROUP BY a.id, a.code, a.name, a.type
         ORDER BY a.code`,
        [auth.companyId, from, to]
      );

      let totalDebit = 0, totalCredit = 0;
      for (const r of accounts.rows) {
        const bal = parseFloat(r.balance) || 0;
        if (['asset', 'expense'].includes(r.type)) {
          r.normal_balance = bal >= 0 ? 'debit' : 'credit';
        } else {
          r.normal_balance = bal >= 0 ? 'credit' : 'debit';
        }
        totalDebit += parseFloat(r.total_debit) || 0;
        totalCredit += parseFloat(r.total_credit) || 0;
      }

      return success({
        accounts: accounts.rows,
        total_debit: totalDebit,
        total_credit: totalCredit,
      });
    }

    if (type === 'income_statement') {
      const revenue = await query(
        `SELECT a.id, a.code, a.name,
          COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as amount
         FROM accounts a
         LEFT JOIN journal_lines jl ON a.id = jl.account_id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
           AND ($2::date IS NULL OR je.date >= $2)
           AND ($3::date IS NULL OR je.date <= $3)
         WHERE a.company_id = $1 AND a.type = 'revenue' AND a.is_active = true
         GROUP BY a.id, a.code, a.name ORDER BY a.code`,
        [auth.companyId, from, to]
      );

      const expenses = await query(
        `SELECT a.id, a.code, a.name,
          COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as amount
         FROM accounts a
         LEFT JOIN journal_lines jl ON a.id = jl.account_id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
           AND ($2::date IS NULL OR je.date >= $2)
           AND ($3::date IS NULL OR je.date <= $3)
         WHERE a.company_id = $1 AND a.type = 'expense' AND a.is_active = true
         GROUP BY a.id, a.code, a.name ORDER BY a.code`,
        [auth.companyId, from, to]
      );

      const totalRevenue = revenue.rows.reduce((s: number, r: any) => s + (parseFloat(r.amount) || 0), 0);
      const totalExpenses = expenses.rows.reduce((s: number, r: any) => s + (parseFloat(r.amount) || 0), 0);

      return success({
        revenue: revenue.rows,
        expenses: expenses.rows,
        total_revenue: totalRevenue,
        total_expenses: totalExpenses,
        net_income: totalRevenue - totalExpenses,
      });
    }

    if (type === 'balance_sheet') {
      const assets = await query(
        `SELECT a.id, a.code, a.name,
          COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as balance
         FROM accounts a
         LEFT JOIN journal_lines jl ON a.id = jl.account_id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
           AND ($2::date IS NULL OR je.date <= $2)
          WHERE a.company_id = $1 AND a.type = 'asset' AND a.is_active = true
          GROUP BY a.id, a.code, a.name ORDER BY a.code`,
        [auth.companyId, to]
      );

      const liabilities = await query(
        `SELECT a.id, a.code, a.name,
          COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as balance
         FROM accounts a
         LEFT JOIN journal_lines jl ON a.id = jl.account_id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
           AND ($2::date IS NULL OR je.date <= $2)
          WHERE a.company_id = $1 AND a.type = 'liability' AND a.is_active = true
          GROUP BY a.id, a.code, a.name ORDER BY a.code`,
        [auth.companyId, to]
      );

      const equity = await query(
        `SELECT a.id, a.code, a.name,
          COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as balance
         FROM accounts a
         LEFT JOIN journal_lines jl ON a.id = jl.account_id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
           AND ($2::date IS NULL OR je.date <= $2)
          WHERE a.company_id = $1 AND a.type = 'equity' AND a.is_active = true
          GROUP BY a.id, a.code, a.name ORDER BY a.code`,
        [auth.companyId, to]
      );

      const totalAssets = assets.rows.reduce((s: number, r: any) => s + (parseFloat(r.balance) || 0), 0);
      const totalLiabilities = liabilities.rows.reduce((s: number, r: any) => s + (parseFloat(r.balance) || 0), 0);
      const totalEquity = equity.rows.reduce((s: number, r: any) => s + (parseFloat(r.balance) || 0), 0);

      return success({
        assets: assets.rows,
        liabilities: liabilities.rows,
        equity: equity.rows,
        total_assets: totalAssets,
        total_liabilities: totalLiabilities,
        total_equity: totalEquity,
      });
    }

    return error('Invalid report type');
  } catch (err) {
    return handleApiError(err);
  }
}
