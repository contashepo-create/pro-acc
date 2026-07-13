import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await paramsPromise;
    const s = sb();

    const { data: entryRes, error: entryErr } = await s.from('journal_entries')
      .select('id, company_id, number, date, type, description, reference, created_by, created_at')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (entryErr || !entryRes) return notFound();

    const { data: linesRes } = await s.from('journal_lines')
      .select('id, account_code, accounts(name, type), debit, credit, description')
      .eq('journal_entry_id', id).order('id');

    const lines = (linesRes || []).map((l: any) => ({
      id: l.id, account_code: l.account_code, account_name: (l.accounts as any)?.name || null,
      account_type: (l.accounts as any)?.type || null, debit: parseFloat(l.debit) || 0,
      credit: parseFloat(l.credit) || 0, description: l.description,
    }));

    const totalDebit = lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0);

    return success({ ...entryRes, totalDebit, totalCredit, lines });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await paramsPromise;
    const s = sb();

    const { data: entryRes } = await s.from('journal_entries')
      .select('id, number, date, type').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!entryRes) return notFound();

    const { data: reversalRes } = await s.from('journal_entries')
      .select('id').eq('reference', id).eq('company_id', auth.companyId).limit(1);
    if (reversalRes && reversalRes.length > 0) {
      return error('لا يمكن حذف قيد له قيود عكسية. قم بحذف القيود العكسية أولاً');
    }

    const { error: lErr } = await s.from('journal_lines').delete().eq('journal_entry_id', id);
    if (lErr) throw lErr;
    const { error: jeErr } = await s.from('journal_entries').delete().eq('id', id);
    if (jeErr) throw jeErr;

    return success({ message: 'تم حذف القيد بنجاح' });
  } catch (err) {
    return handleApiError(err);
  }
}
