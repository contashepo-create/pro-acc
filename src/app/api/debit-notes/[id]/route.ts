import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'credit_notes', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الإشعار غير صالح');
    const s = sb();

    const { data: note, error: noteError } = await s.from('credit_notes')
      .select('*').eq('id', id).eq('company_id', auth.companyId).eq('note_type', 'debit').maybeSingle();
    if (noteError) throw noteError;
    if (!note) return notFound();
    const row = note as Row;

    const { data: items, error: itemsError } = await s.from('credit_note_items')
      .select('*').eq('credit_note_id', id).eq('company_id', auth.companyId).order('id');
    if (itemsError) throw itemsError;

    const [contactResult, invoiceResult, projectResult] = await Promise.all([
      row.contact_id
        ? s.from('contacts').select('id, name').eq('id', row.contact_id).eq('company_id', auth.companyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      row.invoice_id
        ? s.from('invoices').select('id, number').eq('id', row.invoice_id).eq('company_id', auth.companyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      row.project_id
        ? s.from('projects').select('id, name').eq('id', row.project_id).eq('company_id', auth.companyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    for (const result of [contactResult, invoiceResult, projectResult]) if (result.error) throw result.error;
    if ((row.contact_id && !contactResult.data) || (row.invoice_id && !invoiceResult.data)
      || (row.project_id && !projectResult.data)) {
      throw new Error('Debit note contains a missing or cross-tenant relationship');
    }

    return success({
      ...row,
      items: items || [],
      contact_name: (contactResult.data as Row)?.name || null,
      invoice_number: (invoiceResult.data as Row)?.number || null,
      project_name: (projectResult.data as Row)?.name || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE = إلغاء الإشعار المدين مع قيد عكسي (لا حذف مادي). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'credit_notes', 'delete');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الإشعار غير صالح');
    const { data: cancelled, error: cancelError } = await sb().rpc('cancel_credit_note_atomic', {
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
