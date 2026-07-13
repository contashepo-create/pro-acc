import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'trial_balance';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // Get all accounts for this company
    const { data: accounts } = await s.from('accounts')
      .select('id, code, name, type').eq('company_id', auth.companyId).eq('is_active', true);
    if (!accounts) return success({ accounts: [], total_debit: 0, total_credit: 0 });

    // Get journal entries filtered by date
    let jeQuery = s.from('journal_entries').select('id').eq('company_id', auth.companyId);
    if (from) jeQuery = jeQuery.gte('date', from);
    if (to) jeQuery = jeQuery.lte('date', to);
    const { data: jes } = await jeQuery;
    const jeIds = (jes || []).map((je: any) => je.id);

    // Get journal lines
    let linesData: any[] = [];
    if (jeIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('account_id, debit, credit').in('journal_entry_id', jeIds);
      linesData = lines || [];
    }

    // Aggregate by account
    const accountMap: Record<string, { total_debit: number; total_credit: number }> = {};
    for (const l of linesData) {
      if (!accountMap[l.account_id]) accountMap[l.account_id] = { total_debit: 0, total_credit: 0 };
      accountMap[l.account_id].total_debit += parseFloat(l.debit) || 0;
      accountMap[l.account_id].total_credit += parseFloat(l.credit) || 0;
    }

    if (type === 'trial_balance') {
      let totalDebit = 0, totalCredit = 0;
      const result = accounts.map((a: any) => {
        const bal = accountMap[a.id] || { total_debit: 0, total_credit: 0 };
        const balance = bal.total_debit - bal.total_credit;
        let normal_balance;
        if (['asset', 'expense'].includes(a.type)) {
          normal_balance = balance >= 0 ? 'debit' : 'credit';
        } else {
          normal_balance = balance >= 0 ? 'credit' : 'debit';
        }
        totalDebit += bal.total_debit;
        totalCredit += bal.total_credit;
        return { id: a.id, code: a.code, name: a.name, type: a.type, total_debit: bal.total_debit, total_credit: bal.total_credit, balance, normal_balance };
      }).sort((a, b) => a.code.localeCompare(b.code));

      return success({ accounts: result, total_debit: totalDebit, total_credit: totalCredit });
    }

    if (type === 'income_statement') {
      const revenue = accounts.filter((a: any) => a.type === 'revenue').map((a: any) => {
        const bal = accountMap[a.id] || { total_debit: 0, total_credit: 0 };
        return { id: a.id, code: a.code, name: a.name, amount: bal.total_credit - bal.total_debit };
      }).sort((a, b) => a.code.localeCompare(b.code));

      const expenses = accounts.filter((a: any) => a.type === 'expense').map((a: any) => {
        const bal = accountMap[a.id] || { total_debit: 0, total_credit: 0 };
        return { id: a.id, code: a.code, name: a.name, amount: bal.total_debit - bal.total_credit };
      }).sort((a, b) => a.code.localeCompare(b.code));

      const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
      const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
      return success({ revenue, expenses, total_revenue: totalRevenue, total_expenses: totalExpenses, net_income: totalRevenue - totalExpenses });
    }

    if (type === 'balance_sheet') {
      const assets = accounts.filter((a: any) => a.type === 'asset').map((a: any) => {
        const bal = accountMap[a.id] || { total_debit: 0, total_credit: 0 };
        return { id: a.id, code: a.code, name: a.name, balance: bal.total_debit - bal.total_credit };
      }).sort((a, b) => a.code.localeCompare(b.code));

      const liabilities = accounts.filter((a: any) => a.type === 'liability').map((a: any) => {
        const bal = accountMap[a.id] || { total_debit: 0, total_credit: 0 };
        return { id: a.id, code: a.code, name: a.name, balance: bal.total_credit - bal.total_debit };
      }).sort((a, b) => a.code.localeCompare(b.code));

      const equity = accounts.filter((a: any) => a.type === 'equity').map((a: any) => {
        const bal = accountMap[a.id] || { total_debit: 0, total_credit: 0 };
        return { id: a.id, code: a.code, name: a.name, balance: bal.total_credit - bal.total_debit };
      }).sort((a, b) => a.code.localeCompare(b.code));

      const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
      const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
      const totalEquity = equity.reduce((s, r) => s + r.balance, 0);
      return success({ assets, liabilities, equity, total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity });
    }

    return error('Invalid report type');
  } catch (err) {
    return handleApiError(err);
  }
}
