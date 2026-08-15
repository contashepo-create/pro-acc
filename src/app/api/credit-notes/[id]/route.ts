import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'credit_notes', 'read');
    const { id } = await params;
    const s = sb();

    const { data: cn, error: err } = await s.from('credit_notes')
      .select('*, contacts(name), invoices(number), projects(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();

    if (err) throw err;
    if (!cn) return notFound();

    const { data: items } = await s.from('credit_note_items')
      .select('*').eq('credit_note_id', id).eq('company_id', auth.companyId).order('id');

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
    const auth = await requireModulePermission(req, 'credit_notes', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('credit_notes')
      .select('id, journal_entry_id, number, status')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();

    if (!existing) return notFound();

    const cn = existing as any;

    if (cn.status === 'cancelled') return error('الإشعار ملغى بالفعل', 409);
    if (cn.status === 'draft' && !cn.journal_entry_id) {
      await s.from('credit_note_items').delete().eq('credit_note_id', id).eq('company_id', auth.companyId);
      const { error: deleteError } = await s.from('credit_notes').delete().eq('id', id).eq('company_id', auth.companyId);
      if (deleteError) throw deleteError;
      return success({ deleted: true });
    }
    if (!cn.journal_entry_id) return error('الإشعار المعتمد لا يملك قيداً يمكن عكسه', 409);

    const { postReversalEntry } = await import('@/lib/voucher-utils');
    const reversal = await postReversalEntry(auth.companyId, {
      journalEntryId: cn.journal_entry_id,
      referenceType: 'credit_note_cancellation', referenceId: id,
      description: `إلغاء الإشعار الدائن ${cn.number}`, userId: auth.userId,
    });
    if (reversal.error) throw reversal.error;
    const { error: updateError } = await s.from('credit_notes')
      .update({ status: 'cancelled', deleted_at: new Date().toISOString() })
      .eq('id', id).eq('company_id', auth.companyId).eq('status', cn.status);
    if (updateError) throw updateError;

    return success({ cancelled: true });
  } catch (err) {
    return handleApiError(err);
  }
}
