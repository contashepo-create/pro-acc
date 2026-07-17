import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

interface ConsolidatedItem {
  companyId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  balance: number;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface JournalLine {
  debit: number | string;
  credit: number | string;
}

/**
 * GET /api/reports/consolidation
 * توحيد مالي لمجموعة شركات (Financial Consolidation)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);

    const companyIdsParam = url.searchParams.get('company_ids');
    const asOfDate = url.searchParams.get('as_of_date') || new Date().toISOString().split('T')[0];

    let companyIds: string[] = [];

    if (companyIdsParam) {
      companyIds = companyIdsParam.split(',');
    } else {
      companyIds = [auth.companyId];
    }

    if (companyIds.length === 0) {
      return error('يجب تحديد شركة واحدة على الأقل للتوحيد');
    }

    const consolidatedData = {
      assets: [] as ConsolidatedItem[],
      liabilities: [] as ConsolidatedItem[],
      equity: [] as ConsolidatedItem[],
      revenue: [] as ConsolidatedItem[],
      expenses: [] as ConsolidatedItem[],
    };

    const intercompanyEliminations = {
      receivables: 0,
      payables: 0,
      revenue: 0,
      expenses: 0,
    };

    for (const companyId of companyIds) {
      const { data: accounts } = await s.from('accounts')
        .select('id, code, name, type')
        .eq('company_id', companyId)
        .eq('is_active', true) as { data: AccountRow[] | null };

      if (!accounts) continue;

      for (const acc of accounts) {
        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('account_id', acc.id)
          .lte('created_at', asOfDate) as { data: JournalLine[] | null };

        const totalDebit = (lines || []).reduce((sum: number, l: JournalLine) => 
          sum + (parseFloat(String(l.debit)) || 0), 0);
        const totalCredit = (lines || []).reduce((sum: number, l: JournalLine) => 
          sum + (parseFloat(String(l.credit)) || 0), 0);

        let balance = 0;
        if (acc.type === 'asset' || acc.type === 'expense') {
          balance = totalDebit - totalCredit;
        } else {
          balance = totalCredit - totalDebit;
        }

        const item: ConsolidatedItem = {
          companyId,
          accountId: acc.id,
          accountCode: acc.code,
          accountName: acc.name,
          accountType: acc.type,
          balance,
        };

        switch (acc.type) {
          case 'asset':
            consolidatedData.assets.push(item);
            break;
          case 'liability':
            consolidatedData.liabilities.push(item);
            break;
          case 'equity':
            consolidatedData.equity.push(item);
            break;
          case 'revenue':
            consolidatedData.revenue.push(item);
            break;
          case 'expense':
            consolidatedData.expenses.push(item);
            break;
        }
      }
    }

    // Calculate totals
    const totals = {
      assets: consolidatedData.assets.reduce((sum, item) => sum + item.balance, 0),
      liabilities: consolidatedData.liabilities.reduce((sum, item) => sum + item.balance, 0),
      equity: consolidatedData.equity.reduce((sum, item) => sum + item.balance, 0),
      revenue: consolidatedData.revenue.reduce((sum, item) => sum + item.balance, 0),
      expenses: consolidatedData.expenses.reduce((sum, item) => sum + item.balance, 0),
    };

    return success({
      asOfDate,
      companyIds,
      data: consolidatedData,
      totals,
      eliminations: intercompanyEliminations,
      isBalanced: Math.abs(totals.assets - (totals.liabilities + totals.equity + (totals.revenue - totals.expenses))) < 0.01,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
