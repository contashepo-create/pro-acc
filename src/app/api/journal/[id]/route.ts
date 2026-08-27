import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'journal', 'read');
    const { id } = await paramsPromise;
    const s = sb();

    // Do NOT select a non-existent `reference` column — the schema uses
    // reference_type / reference_id. A failed GET left the edit form empty.
    let entryRes: unknown = null;
    let entryErr: unknown = null;
    const primary = await s.from('journal_entries')
      .select('id, company_id, number, date, type, description, reference_type, reference_id, created_by, created_at')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    entryRes = primary.data;
    entryErr = primary.error;

    if (entryErr) {
      const fallback = await s.from('journal_entries')
        .select('id, company_id, number, date, type, description, created_by, created_at')
        .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      entryRes = fallback.data;
      entryErr = fallback.error;
    }
    if (entryErr || !entryRes) return notFound();

    const { data: linesRes } = await s.from('journal_lines')
      .select('id, account_code, accounts(name, type), debit, credit, description')
      .eq('journal_entry_id', id)
      .eq('company_id', auth.companyId)
      .order('id');

    const lines = (linesRes || []).map((l: Row) => ({
      id: l.id, account_code: l.account_code, account_name: (l.accounts as Row)?.name || null,
      account_type: (l.accounts as Row)?.type || null, debit: parseFloat(String(l.debit)) || 0,
      credit: parseFloat(String(l.credit)) || 0, description: l.description,
    }));

    const totalDebit = lines.reduce((s: number, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s: number, l) => s + l.credit, 0);

    return success({ ...entryRes, totalDebit, totalCredit, lines });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'journal', 'update');
    const { id } = await paramsPromise;
    const { data: existing } = await sb().from('journal_entries').select('id')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    return error('القيود المرحّلة غير قابلة للتعديل؛ أنشئ قيداً عكسياً ثم قيد تصحيح جديداً', 409);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await paramsPromise;
    const s = sb();
    const { data: entry } = await s.from('journal_entries')
      .select('id, number, description').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!entry) return notFound();
    const { postReversalEntry } = await import('@/lib/voucher-utils');
    const reversal = await postReversalEntry(auth.companyId, {
      journalEntryId: id, referenceType: 'manual_journal_reversal', referenceId: id,
      description: `عكس القيد رقم ${(entry as Row).number}: ${(entry as Row).description || ''}`,
      userId: auth.userId,
    });
    if (reversal.error) throw reversal.error;
    return success({ reversed: true, message: 'تم إنشاء قيد عكسي مع الاحتفاظ بالقيد الأصلي' });
  } catch (err) {
    return handleApiError(err);
  }
}
