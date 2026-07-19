import { NextRequest } from 'next/server';
import { success, requireApiAuth, requireModulePermission, handleApiError, error } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * General Ledger (الأستاذ العام)
 * Shows all transactions for a specific account or all accounts
 * with running balance
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, \'reports\', \'read\');
    const s = sb();
    const url = new URL(request.url);
    
    const accountId = url.searchParams.get('account_id');
    const accountCode = url.searchParams.get('account_code');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const costCenterId = url.searchParams.get('cost_center_id');
    const branchId = url.searchParams.get('branch_id');

    let account: any = null;

    if (accountId) {
      const { data } = await s.from('accounts')
        .select('id, code, name, type')
        .eq('id', accountId)
        .eq('company_id', auth.companyId)
        .single();
      account = data;
    } else if (accountCode) {
      const { data } = await s.from('accounts')
        .select('id, code, name, type')
        .eq('code', accountCode)
        .eq('company_id', auth.companyId)
        .single();
      account = data;
    }

    if (!account && (accountId || accountCode)) {
      return error('الحساب غير موجود', 404);
    }

    // Get journal entries for date range
    let entryQuery = s.from('journal_entries')
      .select('id, number, date, description, reference, type')
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .order('date', { ascending: true })
      .order('number', { ascending: true });

    if (from) entryQuery = entryQuery.gte('date', from);
    if (to) entryQuery = entryQuery.lte('date', to);

    const { data: entries } = await entryQuery;

    const entryIds = (entries || []).map((e: any) => e.id);
    const entryMap = new Map((entries || []).map((e: any) => [e.id, e]));

    if (entryIds.length === 0) {
      return success({
        account: account || null,
        transactions: [],
        opening_balance: 0,
        total_debit: 0,
        total_credit: 0,
        closing_balance: 0,
      });
    }

    // Get lines for these entries, filtered by account if specified
    let linesQuery = s.from('journal_lines')
      .select('id, journal_entry_id, account_id, account_code, debit, credit, description, cost_center_id, branch_id, accounts(name)')
      .in('journal_entry_id', entryIds)
      .order('id');

    if (account) {
      linesQuery = linesQuery.eq('account_id', account.id);
    }
    if (costCenterId) {
      linesQuery = linesQuery.eq('cost_center_id', costCenterId);
    }
    if (branchId) {
      linesQuery = linesQuery.eq('branch_id', branchId);
    }

    const { data: lines } = await linesQuery;

    // Calculate running balance
    let runningBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    // Get opening balance (before from date)
    if (from && account) {
      let openingQuery = s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId)
        .lt('date', from)
        .is('deleted_at', null);

      const { data: openingEntries } = await openingQuery;
      const openingIds = (openingEntries || []).map((e: any) => e.id);

      if (openingIds.length > 0) {
        const { data: openingLines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('account_id', account.id)
          .in('journal_entry_id', openingIds);

        for (const l of openingLines || []) {
          totalDebit += parseFloat((l as any).debit) || 0;
          totalCredit += parseFloat((l as any).credit) || 0;
        }

        if (account.type === 'asset' || account.type === 'expense') {
          runningBalance = totalDebit - totalCredit;
        } else {
          runningBalance = totalCredit - totalDebit;
        }
      }
    }

    const openingBalance = runningBalance;
    totalDebit = 0;
    totalCredit = 0;

    const transactions = (lines || []).map((line: any) => {
      const entry = entryMap.get(line.journal_entry_id);
      const debit = parseFloat(line.debit) || 0;
      const credit = parseFloat(line.credit) || 0;

      totalDebit += debit;
      totalCredit += credit;

      if (account) {
        if (account.type === 'asset' || account.type === 'expense') {
          runningBalance += debit - credit;
        } else {
          runningBalance += credit - debit;
        }
      } else {
        // If no specific account, balance is debit - credit for reporting
        runningBalance += debit - credit;
      }

      return {
        id: line.id,
        date: entry?.date,
        number: entry?.number,
        description: entry?.description || line.description,
        reference: entry?.reference,
        account_code: line.account_code,
        account_name: line.accounts?.name || line.account_name,
        debit,
        credit,
        balance: runningBalance,
        cost_center_id: line.cost_center_id,
        branch_id: line.branch_id,
      };
    });

    return success({
      account: account || null,
      opening_balance: openingBalance,
      transactions,
      total_debit: totalDebit,
      total_credit: totalCredit,
      closing_balance: runningBalance,
      count: transactions.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
