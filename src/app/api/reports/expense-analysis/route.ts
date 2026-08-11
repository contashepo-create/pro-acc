import { NextRequest } from 'next/server';
import { success, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Expense Breakdown Analysis (تقرير تحليل وتصنيف المصروفات)
 * Analyzes operational, administrative, and direct costs with proportions and percentages.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // 1. Get all expense accounts (type = 'expense')
    const { data: expenseAccounts } = await s.from('accounts')
      .select('id, code, name, parent_id')
      .eq('company_id', auth.companyId)
      .eq('type', 'expense')
      .eq('is_active', true)
      .order('code');

    const expAccountIds = (expenseAccounts || []).map((a: any) => a.id);

    if (expAccountIds.length === 0) {
      return success({ categories: [], total_expense: 0 });
    }

    // 2. Query journal entries in period
    let jeQuery = s.from('journal_entries')
      .select('id, date')
      .eq('company_id', auth.companyId)
      .is('deleted_at', null);

    if (from) jeQuery = jeQuery.gte('date', from);
    if (to) jeQuery = jeQuery.lte('date', to);

    const { data: entries } = await jeQuery;
    const entryIds = (entries || []).map((e: any) => e.id);

    const amountByAccount = new Map<string, number>();

    if (entryIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('account_id, debit, credit')
        .eq('company_id', auth.companyId)
        .in('account_id', expAccountIds)
        .in('journal_entry_id', entryIds);

      for (const l of lines || []) {
        const netExpense = (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0);
        amountByAccount.set(l.account_id, (amountByAccount.get(l.account_id) || 0) + netExpense);
      }
    }

    const categories = (expenseAccounts || []).map((acc: any) => {
      const amount = amountByAccount.get(acc.id) || 0;
      return {
        id: acc.id,
        code: acc.code,
        name: acc.name,
        amount: Math.max(0, amount),
      };
    }).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);

    const totalExpense = categories.reduce((sum, c) => sum + c.amount, 0);

    const withPercentages = categories.map((c) => ({
      ...c,
      percentage: totalExpense > 0 ? (c.amount / totalExpense) * 100 : 0,
    }));

    return success({
      categories: withPercentages,
      total_expense: totalExpense,
      count: withPercentages.length,
      period: { from, to },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
