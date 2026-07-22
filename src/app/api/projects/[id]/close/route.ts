import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

/**
 * POST /api/projects/[id]/close
 * إقفال مشروع محاسبياً
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);

    const { data: project, error: projErr } = await s.from('projects')
      .select('*, contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (projErr) throw projErr;
    if (!project) return notFound();

    const p = project as any;

    if (p.status === 'completed') return error('المشروع مكتمل بالفعل');
    if (p.status === 'cancelled') return error('لا يمكن إقفال مشروع ملغى');

    const closeDate = body.close_date || new Date().toISOString().split('T')[0];
    const notes = body.notes || '';

    // حساب إجمالي الإيرادات والمصروفات
    const { data: entries } = await s.from('journal_entries')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('project_id', id);

    const entryIds = (entries || []).map((e: any) => e.id);

    let totalRevenue = 0;
    let totalExpenses = 0;
    let netProfit = 0;

    if (entryIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('debit, credit, accounts(code, name, type)')
        .in('journal_entry_id', entryIds);

      for (const line of lines || []) {
        const acc = (line as any).accounts;
        const debit = parseFloat((line as any).debit) || 0;
        const credit = parseFloat((line as any).credit) || 0;

        if (acc?.type === 'revenue') totalRevenue += credit - debit;
        else if (acc?.type === 'expense') totalExpenses += debit - credit;
      }
    }

    netProfit = totalRevenue - totalExpenses;

    let closureJournalId: string | null = null;

    if (Math.abs(netProfit) > 0.01) {
      const { data: revenueAccounts } = await s.from('accounts')
        .select('id, code, name')
        .eq('company_id', auth.companyId)
        .eq('type', 'revenue');

      const { data: expenseAccounts } = await s.from('accounts')
        .select('id, code, name')
        .eq('company_id', auth.companyId)
        .eq('type', 'expense');

      const { data: retainedAcc } = await s.from('accounts')
        .select('id')
        .eq('code', ACCOUNT_CODES.RETAINED_EARNINGS)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (revenueAccounts && expenseAccounts && retainedAcc) {
        const lines: any[] = [];

        for (const revAcc of revenueAccounts) {
          const { data: revLines } = await s.from('journal_lines')
            .select('debit, credit')
            .in('journal_entry_id', entryIds)
            .eq('account_id', (revAcc as any).id);

          const creditMinusDebit = (revLines || []).reduce(
            (sum: number, l: any) => sum + (parseFloat(l.credit) || 0) - (parseFloat(l.debit) || 0), 0
          );

          if (Math.abs(creditMinusDebit) > 0.01) {
            lines.push({
              account_id: (revAcc as any).id,
              debit: creditMinusDebit,
              credit: 0,
              description: `إقفال إيرادات مشروع: ${p.name}`,
              project_id: id,
            });
          }
        }

        for (const expAcc of expenseAccounts) {
          const { data: expLines } = await s.from('journal_lines')
            .select('debit, credit')
            .in('journal_entry_id', entryIds)
            .eq('account_id', (expAcc as any).id);

          const debitMinusCredit = (expLines || []).reduce(
            (sum: number, l: any) => sum + (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0), 0
          );

          if (Math.abs(debitMinusCredit) > 0.01) {
            lines.push({
              account_id: (expAcc as any).id,
              debit: 0,
              credit: debitMinusCredit,
              description: `إقفال مصروفات مشروع: ${p.name}`,
              project_id: id,
            });
          }
        }

        if (lines.length > 0) {
          if (netProfit > 0) {
            lines.push({
              account_id: (retainedAcc as any).id,
              debit: 0,
              credit: netProfit,
              description: `صافي ربح مشروع: ${p.name}`,
              project_id: id,
            });
          } else {
            lines.push({
              account_id: (retainedAcc as any).id,
              debit: Math.abs(netProfit),
              credit: 0,
              description: `صافي خسارة مشروع: ${p.name}`,
              project_id: id,
            });
          }

          const je = await createJournalEntry(auth.companyId, {
            date: closeDate,
            type: 'general',
            description: `قيد إقفال مشروع: ${p.name}${notes ? ' - ' + notes : ''}`,
            lines,
            reference_type: 'project_closure',
            reference_id: id,
            created_by: auth.userId,
          });

          if (!je.error) closureJournalId = je.journalId;
        }
      }
    }

    const { data: updated, error: updateErr } = await s.from('projects')
      .update({
        status: 'completed',
        end_date: closeDate,
        closed_at: new Date().toISOString(),
        closed_by: auth.userId,
        closure_journal_entry_id: closureJournalId,
      })
      .eq('id', id)
      .select('*, contacts(name)')
      .single();

    if (updateErr) throw updateErr;

    const result = updated as Record<string, any>;
    result.client_name = result.contacts?.name || null;
    result.closure_summary = {
      total_revenue: totalRevenue,
      total_expenses: totalExpenses,
      net_profit: netProfit,
      profit_margin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0,
      closure_journal_entry_id: closureJournalId,
    };

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
