import { NextRequest } from 'next/server';
import { success, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Cash Flow Statement (قائمة التدفقات النقدية)
 * - Operating Activities (الأنشطة التشغيلية)
 * - Investing Activities (الأنشطة الاستثمارية)
 * - Financing Activities (الأنشطة التمويلية)
 * With exact proportional multi-line journal attribution (no multiplier bugs).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const { listCashBankAccountIds } = await import('@/lib/account-resolve');
    const cashAccountIds = await listCashBankAccountIds(s, auth.companyId);
    const cashIdSet = new Set(cashAccountIds);

    if (cashAccountIds.length === 0) {
      return success({
        operating: { inflows: [], outflows: [], net: 0, total_inflows: 0, total_outflows: 0 },
        investing: { inflows: [], outflows: [], net: 0, total_inflows: 0, total_outflows: 0 },
        financing: { inflows: [], outflows: [], net: 0, total_inflows: 0, total_outflows: 0 },
        net_change: 0,
        opening_balance: 0,
        closing_balance: 0,
      });
    }

    // 1. Calculate opening cash balance (before 'from' date)
    let openingBalance = 0;
    if (from) {
      const { data: priorEntries } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId)
        .lt('date', from)
        .is('deleted_at', null);

      const priorEntryIds = (priorEntries || []).map((e: any) => e.id);
      if (priorEntryIds.length > 0) {
        const { data: priorLines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('company_id', auth.companyId)
          .in('account_id', cashAccountIds)
          .in('journal_entry_id', priorEntryIds);

        for (const l of priorLines || []) {
          openingBalance += (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0);
        }
      }
    }

    // 2. Fetch period journal entries
    let jeQuery = s.from('journal_entries')
      .select('id, number, date, description')
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .order('date', { ascending: true });

    if (from) jeQuery = jeQuery.gte('date', from);
    if (to) jeQuery = jeQuery.lte('date', to);

    const { data: entries } = await jeQuery;
    const entryIds = (entries || []).map((e: any) => e.id);
    const entryMap = new Map((entries || []).map((e: any) => [e.id, e]));

    if (entryIds.length === 0) {
      return success({
        period: { from, to },
        opening_balance: openingBalance,
        operating: { inflows: [], outflows: [], total_inflows: 0, total_outflows: 0, net: 0 },
        investing: { inflows: [], outflows: [], total_inflows: 0, total_outflows: 0, net: 0 },
        financing: { inflows: [], outflows: [], total_inflows: 0, total_outflows: 0, net: 0 },
        net_change: 0,
        closing_balance: openingBalance,
      });
    }

    // 3. Batch fetch all lines for these period entries
    const { data: allLines } = await s.from('journal_lines')
      .select('journal_entry_id, account_id, account_code, account_name, debit, credit, description, accounts!account_id(code, name, type)')
      .eq('company_id', auth.companyId)
      .in('journal_entry_id', entryIds);

    const linesByEntry = new Map<string, any[]>();
    for (const l of allLines || []) {
      const list = linesByEntry.get(l.journal_entry_id) || [];
      list.push(l);
      linesByEntry.set(l.journal_entry_id, list);
    }

    const operatingInflows: any[] = [];
    const operatingOutflows: any[] = [];
    const investingInflows: any[] = [];
    const investingOutflows: any[] = [];
    const financingInflows: any[] = [];
    const financingOutflows: any[] = [];

    for (const [jeId, lines] of linesByEntry.entries()) {
      const entry = entryMap.get(jeId);
      const cashLinesInEntry = lines.filter((l: any) => cashIdSet.has(l.account_id));
      const nonCashLines = lines.filter((l: any) => !cashIdSet.has(l.account_id));

      if (cashLinesInEntry.length === 0) continue;

      const totalCashDebit = cashLinesInEntry.reduce((s: number, l: any) => s + (parseFloat(l.debit) || 0), 0);
      const totalCashCredit = cashLinesInEntry.reduce((s: number, l: any) => s + (parseFloat(l.credit) || 0), 0);

      // Cash Inflow (Debit to Cash)
      if (totalCashDebit > 0) {
        const totalCredits = nonCashLines.reduce((s: number, l: any) => s + (parseFloat(l.credit) || 0), 0);
        for (const o of nonCashLines) {
          const cred = parseFloat(o.credit) || 0;
          if (cred <= 0) continue;

          // Proportional share of cash in
          const lineShare = totalCredits > 0 ? (cred / totalCredits) * totalCashDebit : cred;
          const accCode = o.account_code || o.accounts?.code || '';
          const accType = o.accounts?.type || '';

          let activity = 'operating';
          if (accCode.startsWith('12') || accCode.startsWith('13')) activity = 'investing';
          else if (accCode.startsWith('22') || accCode.startsWith('31') || accCode.startsWith('32')) activity = 'financing';

          const item = {
            date: entry?.date,
            number: entry?.number,
            account_code: accCode,
            account_name: o.account_name || o.accounts?.name || 'حساب',
            amount: lineShare,
            description: o.description || entry?.description || 'مقبوضات نقدية',
          };

          if (activity === 'operating') operatingInflows.push(item);
          else if (activity === 'investing') investingInflows.push(item);
          else financingInflows.push(item);
        }
      }

      // Cash Outflow (Credit to Cash)
      if (totalCashCredit > 0) {
        const totalDebits = nonCashLines.reduce((s: number, l: any) => s + (parseFloat(l.debit) || 0), 0);
        for (const o of nonCashLines) {
          const deb = parseFloat(o.debit) || 0;
          if (deb <= 0) continue;

          const lineShare = totalDebits > 0 ? (deb / totalDebits) * totalCashCredit : deb;
          const accCode = o.account_code || o.accounts?.code || '';
          const accType = o.accounts?.type || '';

          let activity = 'operating';
          if (accCode.startsWith('12') || accCode.startsWith('13')) activity = 'investing';
          else if (accCode.startsWith('22') || accCode.startsWith('31') || accCode.startsWith('32')) activity = 'financing';

          const item = {
            date: entry?.date,
            number: entry?.number,
            account_code: accCode,
            account_name: o.account_name || o.accounts?.name || 'حساب',
            amount: lineShare,
            description: o.description || entry?.description || 'مدفوعات نقدية',
          };

          if (activity === 'operating') operatingOutflows.push(item);
          else if (activity === 'investing') investingOutflows.push(item);
          else financingOutflows.push(item);
        }
      }
    }

    const totalOpIn = operatingInflows.reduce((s, i) => s + i.amount, 0);
    const totalOpOut = operatingOutflows.reduce((s, i) => s + i.amount, 0);
    const operatingNet = totalOpIn - totalOpOut;

    const totalInvIn = investingInflows.reduce((s, i) => s + i.amount, 0);
    const totalInvOut = investingOutflows.reduce((s, i) => s + i.amount, 0);
    const investingNet = totalInvIn - totalInvOut;

    const totalFinIn = financingInflows.reduce((s, i) => s + i.amount, 0);
    const totalFinOut = financingOutflows.reduce((s, i) => s + i.amount, 0);
    const financingNet = totalFinIn - totalFinOut;

    const netChange = operatingNet + investingNet + financingNet;
    const closingBalance = openingBalance + netChange;

    return success({
      period: { from, to },
      opening_balance: openingBalance,
      operating: {
        inflows: operatingInflows,
        outflows: operatingOutflows,
        total_inflows: totalOpIn,
        total_outflows: totalOpOut,
        net: operatingNet,
      },
      investing: {
        inflows: investingInflows,
        outflows: investingOutflows,
        total_inflows: totalInvIn,
        total_outflows: totalInvOut,
        net: investingNet,
      },
      financing: {
        inflows: financingInflows,
        outflows: financingOutflows,
        total_inflows: totalFinIn,
        total_outflows: totalFinOut,
        net: financingNet,
      },
      net_change: netChange,
      closing_balance: closingBalance,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
