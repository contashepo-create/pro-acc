import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();
const EPSILON = 0.005;

/**
 * Close one fiscal year using a single balanced entry:
 * revenue (debit) + expenses (credit) + retained earnings (net offset).
 * This zeros every temporary income-statement account and transfers exactly
 * the resulting profit/loss without hard-deleting any historical evidence.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'approve');
    const { id } = await params;
    const s = sb();

    const { data: fiscalYear, error: fiscalError } = await s.from('fiscal_years')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (fiscalError) throw fiscalError;
    if (!fiscalYear) return notFound();
    if (fiscalYear.status === 'closed') return error('السنة المالية مقفلة بالفعل', 409);

    const companyId = auth.companyId;
    const { data: openCustodies, error: custodyError } = await s.from('custodies')
      .select('id').eq('company_id', companyId).eq('status', 'open').limit(1);
    if (custodyError) throw custodyError;
    if (openCustodies && openCustodies.length > 0) return error('لا يمكن إقفال السنة والعُهد مفتوحة');

    const { data: activeProjects, error: projectError } = await s.from('projects')
      .select('id').eq('company_id', companyId).eq('status', 'active').limit(1);
    if (projectError) throw projectError;
    const warnings = activeProjects && activeProjects.length > 0 ? ['هناك مشاريع نشطة'] : [];

    const { data: accounts, error: accountsError } = await s.from('accounts')
      .select('id, code, name, type')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .in('type', ['revenue', 'expense']);
    if (accountsError) throw accountsError;

    const { data: retained, error: retainedError } = await s.from('accounts')
      .select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.RETAINED_EARNINGS).maybeSingle();
    if (retainedError) throw retainedError;
    if (!retained) return error('حساب الأرباح المحتجزة غير موجود', 400);

    const { data: sourceEntries, error: sourceError } = await s.from('journal_entries')
      .select('id')
      .eq('company_id', companyId)
      .gte('date', fiscalYear.start_date)
      .lte('date', fiscalYear.end_date)
      .neq('type', 'closing');
    if (sourceError) throw sourceError;
    const entryIds = (sourceEntries || []).map((entry: { id: string }) => entry.id);

    const balances = new Map<string, number>();
    if (entryIds.length > 0) {
      const { data: lines, error: linesError } = await s.from('journal_lines')
        .select('account_id, debit, credit')
        .eq('company_id', companyId)
        .in('journal_entry_id', entryIds);
      if (linesError) throw linesError;
      for (const line of lines || []) {
        const current = balances.get(line.account_id) || 0;
        balances.set(line.account_id, current + (Number(line.debit) || 0) - (Number(line.credit) || 0));
      }
    }

    const closingLines: Array<{ journal_entry_id: string; account_id: string; debit: number; credit: number; description: string }> = [];
    let totalRevenue = 0;
    let totalExpenses = 0;
    let netIncome = 0;
    for (const account of accounts || []) {
      const balance = Math.round(((balances.get(account.id) || 0) + Number.EPSILON) * 100) / 100;
      if (Math.abs(balance) <= EPSILON) continue;
      // To zero an account, post the exact opposite of its debit-credit net.
      // This also handles abnormal debit-revenue / credit-expense balances
      // rather than silently leaving temporary accounts open.
      closingLines.push({
        journal_entry_id: '',
        account_id: account.id,
        debit: balance < 0 ? Math.abs(balance) : 0,
        credit: balance > 0 ? balance : 0,
        description: `إقفال ${account.type === 'revenue' ? 'إيراد' : 'مصروف'} ${account.name}`,
      });
      if (account.type === 'revenue') {
        totalRevenue += -balance;
        netIncome += -balance;
      } else {
        totalExpenses += balance;
        netIncome -= balance;
      }
    }
    netIncome = Math.round((netIncome + Number.EPSILON) * 100) / 100;
    if (closingLines.length > 0) {
      const closingNumber = await getNextJournalNumber(companyId, fiscalYear.end_date);
      const { data: closingEntry, error: entryError } = await s.from('journal_entries')
        .insert({
          company_id: companyId,
          number: closingNumber,
          date: fiscalYear.end_date,
          type: 'closing',
          description: `قيد إقفال السنة المالية ${fiscalYear.name || ''}`.trim(),
          created_by: auth.userId,
        })
        .select('id')
        .single();
      if (entryError || !closingEntry) throw entryError || new Error('فشل إنشاء قيد الإقفال');

      if (netIncome > EPSILON) {
        closingLines.push({ journal_entry_id: closingEntry.id, account_id: retained.id, debit: 0, credit: netIncome, description: 'نقل صافي الربح إلى الأرباح المحتجزة' });
      } else if (netIncome < -EPSILON) {
        closingLines.push({ journal_entry_id: closingEntry.id, account_id: retained.id, debit: Math.abs(netIncome), credit: 0, description: 'نقل صافي الخسارة من الأرباح المحتجزة' });
      }
      for (const line of closingLines) line.journal_entry_id = closingEntry.id;
      const { error: postingError } = await insertJournalLines(companyId, closingLines);
      if (postingError) {
        await s.from('journal_entries').delete().eq('id', closingEntry.id).eq('company_id', companyId);
        throw postingError;
      }
    }

    const { error: closeError } = await s.from('fiscal_years')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: auth.userId })
      .eq('id', id).eq('company_id', companyId);
    if (closeError) throw closeError;

    return success({ ...fiscalYear, status: 'closed', totalRevenue, totalExpenses, netIncome, warnings });
  } catch (err) {
    return handleApiError(err);
  }
}
