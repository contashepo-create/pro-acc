import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'update');
    const s = sb();
    const body = await parseBody(request);
    const { name, contact_person, specialty, phone, email, tax_number, notes } = body as any;

    const notesText = [
      specialty ? `التخصص: ${specialty}` : '',
      contact_person ? `شخص الاتصال: ${contact_person}` : '',
      notes || '',
    ].filter(Boolean).join(' | ');

    const { data, error: uErr } = await s
      .from('contacts')
      .update({
        name,
        phone: phone || null,
        email: email || null,
        tax_number: tax_number || null,
        notes: notesText || null,
      })
      .eq('id', params.id)
      .eq('company_id', auth.companyId)
      .select()
      .single();
    if (uErr) throw uErr;
    return success({ subcontractor: data });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'delete');
    const s = sb();
    const { error: dErr } = await s
      .from('contacts')
      .delete()
      .eq('id', params.id)
      .eq('company_id', auth.companyId);
    if (dErr) throw dErr;
    return success({ message: 'تم الحذف' });
  } catch (err) {
    return handleApiError(err);
  }
}
