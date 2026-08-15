import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const number = (value: unknown) => Number(value) || 0;

interface ConsolidatedItem {
  companyId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  balance: number;
}

/**
 * Standalone company consolidation view. Cross-company consolidation is not
 * exposed until an explicit, authorized group-company model exists.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'financial_reports', 'read');
    const url = new URL(request.url);
    const asOfDate = url.searchParams.get('as_of_date') || new Date().toISOString().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !Number.isFinite(Date.parse(asOfDate))) return error('تاريخ التقرير غير صالح');

    const { data, error: queryError } = await sb().rpc('get_trial_balance_rows', {
      p_company_id: auth.companyId, p_as_of: asOfDate,
    });
    if (queryError) throw queryError;

    const consolidatedData = {
      assets: [] as ConsolidatedItem[], liabilities: [] as ConsolidatedItem[],
      equity: [] as ConsolidatedItem[], revenue: [] as ConsolidatedItem[], expenses: [] as ConsolidatedItem[],
    };
    for (const row of data || []) {
      const debit = number((row as any).debit);
      const credit = number((row as any).credit);
      const type = String((row as any).account_type);
      const balance = ['asset', 'expense'].includes(type) ? debit - credit : credit - debit;
      if (Math.abs(balance) < 0.0001) continue;
      const item: ConsolidatedItem = {
        companyId: auth.companyId, accountId: (row as any).account_id,
        accountCode: (row as any).account_code, accountName: (row as any).account_name,
        accountType: type, balance,
      };
      const bucket = type === 'asset' ? 'assets' : type === 'liability' ? 'liabilities'
        : type === 'equity' ? 'equity' : type === 'revenue' ? 'revenue' : type === 'expense' ? 'expenses' : null;
      if (bucket) consolidatedData[bucket].push(item);
    }

    const totals = {
      assets: consolidatedData.assets.reduce((sum, item) => sum + item.balance, 0),
      liabilities: consolidatedData.liabilities.reduce((sum, item) => sum + item.balance, 0),
      equity: consolidatedData.equity.reduce((sum, item) => sum + item.balance, 0),
      revenue: consolidatedData.revenue.reduce((sum, item) => sum + item.balance, 0),
      expenses: consolidatedData.expenses.reduce((sum, item) => sum + item.balance, 0),
    };
    const accountingDifference = totals.assets - (totals.liabilities + totals.equity + totals.revenue - totals.expenses);
    return success({
      asOfDate, companyIds: [auth.companyId], data: consolidatedData, totals,
      eliminations: { receivables: 0, payables: 0, revenue: 0, expenses: 0 },
      accountingDifference, isBalanced: Math.abs(accountingDifference) < 0.01,
      scope: 'single_company',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
