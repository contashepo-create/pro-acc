import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';
import { ACCOUNT_CODES } from '@/lib/constants';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: fy } = await s.from('fiscal_years').select('*').eq('id', id).maybeSingle();
    if (!fy) return notFound();
    if (fy.status === 'closed') return error('السنة المالية مقفلة بالفعل');

    const companyId = fy.company_id;
    const endDate = fy.end_date;
    if (companyId !== auth.companyId) return error('غير مصرح به');

    const { data: openCustodies } = await s.from('custodies')
      .select('id').eq('company_id', companyId).eq('status', 'open').limit(1);
    if (openCustodies && openCustodies.length > 0) return error('لا يمكن إقفال السنة والعُهد مفتوحة');

    const warnings: string[] = [];

    const { data: activeProjects } = await s.from('projects')
      .select('id').eq('company_id', companyId).eq('status', 'active').limit(1);
    if (activeProjects && activeProjects.length > 0) warnings.push('هناك مشاريع نشطة');

    const { data: revenueAccounts } = await s.from('accounts')
      .select('id').eq('company_id', companyId).eq('type', 'revenue');
    const { data: expenseAccounts } = await s.from('accounts')
      .select('id').eq('company_id', companyId).eq('type', 'expense');

    // Get all journal entries for this company up to endDate, excluding closing
    const { data: jes } = await s.from('journal_entries')
      .select('id').eq('company_id', companyId).lte('date', endDate).neq('type', 'closing');
    const jeIds = (jes || []).map((je: any) => je.id);

    let totalRevenue = 0;
    let totalExpenses = 0;
    const accountBalances: Record<string, number> = {};

    if (jeIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('account_id, debit, credit').in('journal_entry_id', jeIds);
      for (const l of (lines || [])) {
        const debit = parseFloat(l.debit) || 0;
        const credit = parseFloat(l.credit) || 0;
        if (!accountBalances[l.account_id]) accountBalances[l.account_id] = 0;
        accountBalances[l.account_id] += debit - credit;
      }
    }

    for (const acc of (revenueAccounts || [])) {
      const bal = accountBalances[acc.id] || 0;
      totalRevenue += -bal; // revenue balance = credit - debit = -net
    }
    for (const acc of (expenseAccounts || [])) {
      const bal = accountBalances[acc.id] || 0;
      totalExpenses += bal; // expense balance = debit - credit = net
    }

    const netIncome = totalRevenue - totalExpenses;
    const { data: retainedAccount } = await s.from('accounts')
      .select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.RETAINED_EARNINGS).maybeSingle();

    if (netIncome !== 0 && retainedAccount) {
      const { data: maxJe } = await s.from('journal_entries')
        .select('number').eq('company_id', companyId).order('number', { ascending: false }).limit(1).maybeSingle();
      const closingNumber = ((maxJe as any)?.number || 0) + 1;

      const { data: closingJe, error: jeErr } = await s.from('journal_entries')
        .insert({ company_id: companyId, number: closingNumber, date: endDate, type: 'closing', description: 'قيد إقفال السنة المالية', created_by: auth.userId })
        .select('id').single();
      if (jeErr) throw jeErr;
      const jeId = closingJe.id;

      const closingLines: any[] = [];
      if (netIncome > 0) {
        for (const acc of (revenueAccounts || [])) {
          const bal = -(accountBalances[acc.id] || 0);
          if (bal > 0) closingLines.push({ journal_entry_id: jeId, account_id: acc.id, debit: bal, credit: 0 });
        }
        closingLines.push({ journal_entry_id: jeId, account_id: retainedAccount.id, debit: 0, credit: netIncome });
      } else {
        const loss = Math.abs(netIncome);
        for (const acc of (expenseAccounts || [])) {
          const bal = accountBalances[acc.id] || 0;
          if (bal > 0) closingLines.push({ journal_entry_id: jeId, account_id: acc.id, debit: 0, credit: bal });
        }
        closingLines.push({ journal_entry_id: jeId, account_id: retainedAccount.id, debit: loss, credit: 0 });
      }
      if (closingLines.length > 0) await s.from('journal_lines').insert(closingLines);
    }

    const { error: updErr } = await s.from('fiscal_years')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: auth.userId }).eq('id', id);
    if (updErr) throw updErr;

    return success({ ...fy, status: 'closed', warnings });
  } catch (err) {
    return handleApiError(err);
  }
}
