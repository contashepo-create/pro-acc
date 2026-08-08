import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const offset = (page - 1) * pageSize;
    const { data, error: qErr, count } = await s
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .eq('type', 'subcontractor')
      .order('name')
      .range(offset, offset + pageSize - 1);
    if (qErr) throw qErr;
    return success({ subcontractors: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'create');
    const s = sb();
    const body = await parseBody(request);
    const { name, contact_person, specialty, phone, email, tax_number, notes } = body as any;
    if (!name) return error('الاسم مطلوب');

    const notesText = [
      specialty ? `التخصص: ${specialty}` : '',
      contact_person ? `شخص الاتصال: ${contact_person}` : '',
      notes || '',
    ].filter(Boolean).join(' | ');

    const { data, error: insErr } = await s
      .from('contacts')
      .insert({
        company_id: auth.companyId,
        name,
        type: 'subcontractor',
        phone: phone || null,
        email: email || null,
        tax_number: tax_number || null,
        notes: notesText || null,
      })
      .select()
      .single();
    if (insErr) throw insErr;
    return success({ subcontractor: data }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
