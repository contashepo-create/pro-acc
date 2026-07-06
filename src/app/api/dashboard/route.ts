import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireApiAuth } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);

    const revenue = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM cash_transactions
       WHERE company_id = $1 AND type = 'revenue'`, [auth.companyId]
    );

    const expenses = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM cash_transactions
       WHERE company_id = $1 AND type = 'expense'`, [auth.companyId]
    );

    const ar = await query(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as balance
       FROM journal_lines jl
       JOIN accounts a ON jl.account_id = a.id
       WHERE a.company_id = $1 AND a.code = $2`,
      [auth.companyId, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE]
    );

    const ap = await query(
      `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as balance
       FROM journal_lines jl
       JOIN accounts a ON jl.account_id = a.id
       WHERE a.company_id = $1 AND a.code = $2`,
      [auth.companyId, ACCOUNT_CODES.ACCOUNTS_PAYABLE]
    );

    const cash = await query(
      `SELECT COALESCE(SUM(bs.opening_balance), 0) +
              COALESCE(SUM(ct_rev.amount), 0) -
              COALESCE(SUM(ct_exp.amount), 0) as balance
       FROM banks_safes bs
       LEFT JOIN (SELECT bank_safe_id, SUM(amount) as amount FROM cash_transactions WHERE type = 'revenue' GROUP BY bank_safe_id) ct_rev ON bs.id = ct_rev.bank_safe_id
       LEFT JOIN (SELECT bank_safe_id, SUM(amount) as amount FROM cash_transactions WHERE type = 'expense' GROUP BY bank_safe_id) ct_exp ON bs.id = ct_exp.bank_safe_id
       WHERE bs.company_id = $1`,
      [auth.companyId]
    );

    const activeProjects = await query(
      `SELECT COUNT(*) as cnt FROM projects WHERE company_id = $1 AND status = 'active'`,
      [auth.companyId]
    );

    const overdueInvoices = await query(
      `SELECT COUNT(*) as cnt FROM invoices
       WHERE company_id = $1 AND status IN ('unpaid', 'partial') AND due_date < CURRENT_DATE`,
      [auth.companyId]
    );

    const totalRevenue = parseFloat(revenue.rows[0].total) || 0;
    const totalExpenses = parseFloat(expenses.rows[0].total) || 0;

    return success({
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      net_profit: totalRevenue - totalExpenses,
      accounts_receivable: parseFloat(ar.rows[0].balance) || 0,
      accounts_payable: parseFloat(ap.rows[0].balance) || 0,
      cash_balance: parseFloat(cash.rows[0].balance) || 0,
      active_projects: parseInt(activeProjects.rows[0].cnt, 10) || 0,
      overdue_invoices: parseInt(overdueInvoices.rows[0].cnt, 10) || 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
