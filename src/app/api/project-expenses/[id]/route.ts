import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deleteJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES, PROJECT_EXPENSE_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: expense, error: queryErr } = await s.from('project_expenses')
      .select('*, projects(name), contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryErr) throw queryErr;
    if (!expense) return notFound();

    const result = expense as Record<string, any>;
    result.project_name = result.projects?.name || null;
    result.contact_name = result.contacts?.name || null;

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);

    const { data: existing } = await s.from('project_expenses')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const oldExpense = existing as any;
    const updateData: any = {};

    if (body.description !== undefined) updateData.description = body.description;
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.date !== undefined) updateData.date = body.date;
    if (body.contact_id !== undefined) updateData.contact_id = body.contact_id;
    if (body.notes !== undefined) updateData.notes = body.notes;

    if (body.expense_type !== undefined && PROJECT_EXPENSE_CODES[body.expense_type]) {
      updateData.expense_type = body.expense_type;
      updateData.account_code = PROJECT_EXPENSE_CODES[body.expense_type];
    }

    const { data: updated, error: updateErr } = await s.from('project_expenses')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    if (body.amount !== undefined && oldExpense.journal_entry_id) {
      await deleteJournalEntry(auth.companyId, oldExpense.journal_entry_id);

      const accountCode = body.expense_type
        ? PROJECT_EXPENSE_CODES[body.expense_type]
        : oldExpense.account_code;

      const { data: expenseAcc } = await s.from('accounts')
        .select('id')
        .eq('code', accountCode)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      const { data: cashAcc } = await s.from('accounts')
        .select('id')
        .eq('code', ACCOUNT_CODES.CASH)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (expenseAcc && cashAcc) {
        const { createJournalEntry } = await import('@/lib/journal-utils');
        const je = await createJournalEntry(auth.companyId, {
          date: body.date || oldExpense.date,
          type: 'general',
          description: `تعديل مصروف مشروع: ${body.description || oldExpense.description}`,
          lines: [
            {
              account_id: (expenseAcc as any).id,
              debit: body.amount,
              credit: 0,
              description: body.description || oldExpense.description,
              project_id: oldExpense.project_id,
              contact_id: body.contact_id || oldExpense.contact_id,
            },
            {
              account_id: (cashAcc as any).id,
              debit: 0,
              credit: body.amount,
              description: `دفع مصروف مشروع`,
              project_id: oldExpense.project_id,
              contact_id: body.contact_id || oldExpense.contact_id,
            },
          ],
          reference_type: 'project_expense',
          reference_id: id,
          created_by: auth.userId,
        });

        if (!je.error) {
          await s.from('project_expenses')
            .update({ journal_entry_id: je.journalId })
            .eq('id', id);
        }
      }
    }

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('project_expenses')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const expense = existing as any;

    if (expense.journal_entry_id) {
      await deleteJournalEntry(auth.companyId, expense.journal_entry_id);
    }

    await s.from('project_expenses').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
