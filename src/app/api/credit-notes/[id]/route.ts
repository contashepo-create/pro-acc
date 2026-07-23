import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: cn, error: err } = await s.from('credit_notes')
      .select('*, contacts(name), invoices(number), projects(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();

    if (err) throw err;
    if (!cn) return notFound();

    const { data: items } = await s.from('credit_note_items')
      .select('*').eq('credit_note_id', id).order('id');

    const result = cn as Record<string, any>;
    result.items = items || [];
    result.contact_name = result.contacts?.name || null;
    result.invoice_number = result.invoices?.number || null;
    result.project_name = result.projects?.name || null;

    return success(result);
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

    const { data: existing } = await s.from('credit_notes')
      .select('id, journal_entry_id, number')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();

    if (!existing) return notFound();

    const cn = existing as any;

    // Delete journal entry if exists
    if (cn.journal_entry_id) {
      const { deleteJournalEntry } = await import('@/lib/journal-utils');
      await deleteJournalEntry(auth.companyId, cn.journal_entry_id);
    }

    await s.from('credit_note_items').delete().eq('credit_note_id', id);
    await s.from('credit_notes').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
