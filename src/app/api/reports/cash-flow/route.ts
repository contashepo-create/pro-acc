import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { loadReportJournalEntries, loadReportJournalLines } from '@/lib/report-journal';
import { isValidDate } from '@/lib/utils';

import type { Row } from '@/lib/types';

const number = (value: unknown) => Number(value) || 0;

type Bucket = { inflows: Row[]; outflows: Row[] };

/** Direct-method cash flow, based only on cash/bank ledger movements. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = getSupabase();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');

    const { listCashBankAccountIds } = await import('@/lib/account-resolve');
    const cashAccountIds = await listCashBankAccountIds(s, auth.companyId);
    const cashIds = new Set(cashAccountIds);
    if (!cashAccountIds.length) return success(emptyReport(from, to));

    const { data: accounts, error: accountsError } = await s.from('accounts')
      .select('id, code, name, type').eq('company_id', auth.companyId);
    if (accountsError) throw accountsError;
    const accountMap = new Map<string, Row>((accounts || []).map((account: Row) => [String(account.id), account]));

    let openingBalance = 0;
    if (from) {
      const priorEntries = await loadReportJournalEntries(s, auth.companyId, { to: previousDate(from) });
      const priorLines = await loadReportJournalLines(s, auth.companyId, priorEntries.map((entry) => String(entry.id)));
      openingBalance = priorLines.filter((line: Row) => cashIds.has(String(line.account_id)))
        .reduce((sum: number, line: Row) => sum + number(line.debit) - number(line.credit), 0);
    }

    const entries = await loadReportJournalEntries(s, auth.companyId, { from, to });
    const entryMap = new Map(entries.map((entry) => [String(entry.id), entry]));
    const allLines = await loadReportJournalLines(s, auth.companyId, entries.map((entry) => String(entry.id)));
    const linesByEntry = new Map<string, Row[]>();
    for (const line of allLines) {
      const list = linesByEntry.get(String(line.journal_entry_id)) || [];
      list.push(line);
      linesByEntry.set(String(line.journal_entry_id), list);
    }

    const buckets: Record<'operating' | 'investing' | 'financing', Bucket> = {
      operating: { inflows: [], outflows: [] }, investing: { inflows: [], outflows: [] }, financing: { inflows: [], outflows: [] },
    };
    for (const [entryId, lines] of linesByEntry) {
      const entry = entryMap.get(entryId);
      const cashLines = lines.filter((line: Row) => cashIds.has(String(line.account_id)));
      const counterpartLines = lines.filter((line: Row) => !cashIds.has(String(line.account_id)));
      const cashDebit = cashLines.reduce((sum: number, line: Row) => sum + number(line.debit), 0);
      const cashCredit = cashLines.reduce((sum: number, line: Row) => sum + number(line.credit), 0);
      if (cashDebit > 0) allocate(counterpartLines, 'credit', cashDebit, entry, buckets, 'inflows', accountMap);
      if (cashCredit > 0) allocate(counterpartLines, 'debit', cashCredit, entry, buckets, 'outflows', accountMap);
    }

    const format = (bucket: Bucket) => {
      const totalInflows = bucket.inflows.reduce((sum: number, item: Row) => sum + number(item.amount), 0);
      const totalOutflows = bucket.outflows.reduce((sum: number, item: Row) => sum + number(item.amount), 0);
      return { ...bucket, total_inflows: totalInflows, total_outflows: totalOutflows, net: totalInflows - totalOutflows };
    };
    const operating = format(buckets.operating);
    const investing = format(buckets.investing);
    const financing = format(buckets.financing);
    const netChange = operating.net + investing.net + financing.net;
    return success({
      period: { from, to }, opening_balance: openingBalance,
      operating, investing, financing, net_change: netChange, closing_balance: openingBalance + netChange,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function allocate(
  lines: Row[], side: 'debit' | 'credit', cashTotal: number, entry: Row | undefined,
  buckets: Record<'operating' | 'investing' | 'financing', Bucket>, flow: 'inflows' | 'outflows', accountMap: Map<string, Row>,
) {
  const eligible = lines.filter((line) => number(line[side]) > 0);
  const counterpartTotal = eligible.reduce((sum, line) => sum + number(line[side]), 0);
  if (!counterpartTotal) return;
  for (const line of eligible) {
    const account = accountMap.get(String(line.account_id));
    const code = String(line.account_code || account?.code || '');
    const activity = classify(code);
    buckets[activity][flow].push({
      date: entry?.date, number: entry?.number, account_code: code,
      account_name: line.account_name || account?.name || 'حساب',
      amount: (number(line[side]) / counterpartTotal) * cashTotal,
      description: line.description || entry?.description || (flow === 'inflows' ? 'مقبوضات نقدية' : 'مدفوعات نقدية'),
    });
  }
}

function classify(code: string): 'operating' | 'investing' | 'financing' {
  if (code.startsWith('12') || code.startsWith('13')) return 'investing';
  if (code.startsWith('22') || code.startsWith('31') || code.startsWith('32')) return 'financing';
  return 'operating';
}

function previousDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

function emptyReport(from: string | null, to: string | null) {
  const bucket = { inflows: [], outflows: [], total_inflows: 0, total_outflows: 0, net: 0 };
  return { period: { from, to }, operating: bucket, investing: bucket, financing: bucket, net_change: 0, opening_balance: 0, closing_balance: 0 };
}
