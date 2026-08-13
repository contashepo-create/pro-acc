import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'read');
    const s = sb();
    const { id } = await params;

    const { data, error: qErr } = await s
      .from('contacts')
      .select('id, name, phone, email, tax_number, notes, type')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (qErr || !data) return error('المقاول غير موجود', 404);
    const c = data as Record<string, any>;

    // التخصص وشخص الاتصال مخزّنان مدموجين في حقل notes ("التخصص: … | شخص الاتصال: …")
    // — استعدهما حتى يمتلئ نموذج التعديل بشكل صحيح.
    const parts = (c.notes || '').split('|').map((p: string) => p.trim());
    const specialty = (parts.find((p: string) => p.startsWith('التخصص:')) || '').replace('التخصص:', '').trim();
    const contactPerson = (parts.find((p: string) => p.startsWith('شخص الاتصال:')) || '').replace('شخص الاتصال:', '').trim();
    const restNotes = parts.filter((p: string) => !p.startsWith('التخصص:') && !p.startsWith('شخص الاتصال:')).join(' | ');

    return success({ ...c, specialty, contact_person: contactPerson, notes: restNotes });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'update');
    const s = sb();
    const { id } = await params;
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
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select()
      .single();
    if (uErr) throw uErr;
    return success({ subcontractor: data });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'delete');
    const s = sb();
    const { id } = await params;
    const { error: dErr } = await s
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);
    if (dErr) throw dErr;
    return success({ message: 'تم الحذف' });
  } catch (err) {
    return handleApiError(err);
  }
}
