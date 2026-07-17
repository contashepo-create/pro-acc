import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Cash Flow Statement (قائمة التدفقات النقدية)
 * - Operating Activities (الأنشطة التشغيلية)
 * - Investing Activities (الأنشطة الاستثمارية)
 * - Financing Activities (الأنشطة التمويلية)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // Get cash and bank accounts (1110, 1120)
    const { data: cashAccounts } = await s.from('accounts')
      .select('id, code, name')
      .eq('company_id', auth.companyId)
      .in('code', ['1110', '1120']);

    const cashAccountIds = (cashAccounts || []).map((a: any) => a.id);

    if (cashAccountIds.length === 0) {
      return success({
        operating: { inflows: [], outflows: [], net: 0 },
        investing: { inflows: [], outflows: [], net: 0 },
        financing: { inflows: [], outflows: [], net: 0 },
        net_change: 0,
        opening_balance: 0,
        closing_balance: 0,
      });
    }

    // Get journal entries for date range
    let jeQuery = s.from('journal_entries')
      .select('id, date')
      .eq('company_id', auth.companyId)
      .is('deleted_at', null);

    if (from) jeQuery = jeQuery.gte('date', from);
    if (to) jeQuery = jeQuery.lte('date', to);

    const { data: entries } = await jeQuery;
    const entryIds = (entries || []).map((e: any) => e.id);

    if (entryIds.length === 0) {
      return success({
        operating: { inflows: [], outflows: [], net: 0 },
        investing: { inflows: [], outflows: [], net: 0 },
        financing: { inflows: [], outflows: [], net: 0 },
        net_change: 0,
        opening_balance: 0,
        closing_balance: 0,
      });
    }

    // Get lines that involve cash/bank accounts
    const { data: cashLines } = await s.from('journal_lines')
      .select('journal_entry_id, account_id, debit, credit, description, accounts!account_id(code, name, type)')
      .in('journal_entry_id', entryIds)
      .in('account_id', cashAccountIds);

    // For each cash line, get the opposite side to determine activity type
    const operatingInflows: any[] = [];
    const operatingOutflows: any[] = [];
    const investingInflows: any[] = [];
    const investingOutflows: any[] = [];
    const financingInflows: any[] = [];
    const financingOutflows: any[] = [];

    for (const cashLine of cashLines || []) {
      const cl: any = cashLine;
      const isDebit = (parseFloat(cl.debit) || 0) > 0; // Cash in
      const amount = parseFloat(cl.debit) || parseFloat(cl.credit) || 0;

      // Get other lines in same journal entry to determine nature
      const { data: otherLines } = await s.from('journal_lines')
        .select('account_id, debit, credit, accounts!account_id(code, name, type)')
        .eq('journal_entry_id', cl.journal_entry_id)
        .neq('account_id', cl.account_id);

      for (const other of otherLines || []) {
        const o: any = other;
        const accCode = o.accounts?.code || '';
        const accType = o.accounts?.type || '';

        let activity = 'operating';
        
        // Classify based on account type and code
        if (accCode.startsWith('12') || accCode.startsWith('13') || accType === 'asset' && accCode !== '1110' && accCode !== '1120') {
          // Fixed assets, investments
          activity = 'investing';
        } else if (accCode.startsWith('21') || accCode.startsWith('31') || accCode.startsWith('32')) {
          // Loans, capital
          activity = 'financing';
        } else {
          // Revenue, expenses, receivables, payables = operating
          activity = 'operating';
        }

        const item = {
          date: (await s.from('journal_entries').select('date').eq('id', cl.journal_entry_id).single())?.data?.date || null,
          account_code: o.accounts?.code,
          account_name: o.accounts?.name,
          amount,
          description: cl.description || o.accounts?.name,
          journal_entry_id: cl.journal_entry_id,
        };

        if (isDebit) {
          // Cash in (debit to cash)
          if (activity === 'operating') operatingInflows.push(item);
          else if (activity === 'investing') investingInflows.push(item);
          else financingInflows.push(item);
        } else {
          // Cash out (credit to cash)
          if (activity === 'operating') operatingOutflows.push(item);
          else if (activity === 'investing') investingOutflows.push(item);
          else financingOutflows.push(item);
        }
      }
    }

    const operatingNet = operatingInflows.reduce((sum, i) => sum + i.amount, 0) - operatingOutflows.reduce((sum, i) => sum + i.amount, 0);
    const investingNet = investingInflows.reduce((sum, i) => sum + i.amount, 0) - investingOutflows.reduce((sum, i) => sum + i.amount, 0);
    const financingNet = financingInflows.reduce((sum, i) => sum + i.amount, 0) - financingOutflows.reduce((sum, i) => sum + i.amount, 0);

    const netChange = operatingNet + investingNet + financingNet;

    // Opening balance (before from date)
    let openingBalance = 0;
    if (from) {
      let openingQuery = s.from('journal_entries').select('id').eq('company_id', auth.companyId).lt('date', from).is('deleted_at', null);
      const { data: openingEntries } = await openingQuery;
      const openingIds = (openingEntries || []).map((e: any) => e.id);
      
      if (openingIds.length > 0) {
        const { data: openingLines } = await s.from('journal_lines')
          .select('debit, credit')
          .in('account_id', cashAccountIds)
          .in('journal_entry_id', openingIds);
        
        for (const l of openingLines || []) {
          openingBalance += (parseFloat((l as any).debit) || 0) - (parseFloat((l as any).credit) || 0);
        }
      }
    }

    const closingBalance = openingBalance + netChange;

    return success({
      period: { from, to },
      opening_balance: openingBalance,
      operating: {
        inflows: operatingInflows,
        outflows: operatingOutflows,
        total_inflows: operatingInflows.reduce((sum, i) => sum + i.amount, 0),
        total_outflows: operatingOutflows.reduce((sum, i) => sum + i.amount, 0),
        net: operatingNet,
      },
      investing: {
        inflows: investingInflows,
        outflows: investingOutflows,
        total_inflows: investingInflows.reduce((sum, i) => sum + i.amount, 0),
        total_outflows: investingOutflows.reduce((sum, i) => sum + i.amount, 0),
        net: investingNet,
      },
      financing: {
        inflows: financingInflows,
        outflows: financingOutflows,
        total_inflows: financingInflows.reduce((sum, i) => sum + i.amount, 0),
        total_outflows: financingOutflows.reduce((sum, i) => sum + i.amount, 0),
        net: financingNet,
      },
      net_change: netChange,
      closing_balance: closingBalance,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
