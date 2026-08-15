import { NextRequest } from 'next/server';
import { success, notFound, handleApiError, requireModulePermission } from '@/lib/api-helpers';
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

    const { data: cancelled, error: cancelError } = await s.rpc('cancel_credit_note_atomic', {
      p_company_id: auth.companyId,
      p_credit_note_id: id,
      p_user_id: auth.userId,
    });
    if (cancelError) throw cancelError;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
