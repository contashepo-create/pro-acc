import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const updateSchema = z.object({
  name: z.string().trim().min(1, 'الاسم مطلوب').max(200),
  contact_person: z.string().trim().max(200).optional().nullable(),
  specialty: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email('البريد الإلكتروني غير صالح').max(254).optional().nullable().or(z.literal('')),
  tax_number: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1600).optional().nullable(),
}).strict();
const COLUMNS = 'id, name, type, phone, email, tax_number, contact_person, notes, is_active, created_at';

function subcontractorView(contact: Record<string, unknown>) {
  const parts = String(contact.notes || '').split('|').map((part) => part.trim()).filter(Boolean);
  const specialty = (parts.find((part) => part.startsWith('التخصص:')) || '').replace('التخصص:', '').trim();
  const legacyContactPerson = (parts.find((part) => part.startsWith('شخص الاتصال:')) || '').replace('شخص الاتصال:', '').trim();
  const notes = parts.filter((part) => !part.startsWith('التخصص:') && !part.startsWith('شخص الاتصال:')).join(' | ');
  return { ...contact, specialty, contact_person: contact.contact_person || legacyContactPerson, notes };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المقاول غير صالح');
    const { data, error: queryError } = await sb().from('contacts')
      .select(COLUMNS)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .eq('type', 'subcontractor')
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (queryError) throw queryError;
    if (!data) return error('المقاول غير موجود', 404);
    return success(subcontractorView(data));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المقاول غير صالح');
    const parsed = updateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const notes = [parsed.data.specialty ? `التخصص: ${parsed.data.specialty}` : '', parsed.data.notes || '']
      .filter(Boolean).join(' | ');
    const { data, error: updateError } = await sb().rpc('update_subcontractor_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_patch: {
        name: parsed.data.name,
        contact_person: parsed.data.contact_person || null,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        tax_number: parsed.data.tax_number || null,
        notes: notes || null,
      },
      p_user_id: auth.userId,
    });
    const message = String(updateError?.message || '');
    if (/المقاول غير موجود|الطرف غير موجود/.test(message)) return error('المقاول غير موجود', 404);
    if (message.includes('اسم الطرف مستخدم')) return error('اسم المقاول مستخدم مسبقاً', 409);
    if (updateError) throw updateError;
    return success({ subcontractor: subcontractorView((data || {}) as Record<string, unknown>) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'delete');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المقاول غير صالح');
    const { data, error: deactivateError } = await sb().rpc('deactivate_subcontractor_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_user_id: auth.userId,
    });
    if (deactivateError && /المقاول غير موجود|الطرف غير موجود/.test(String(deactivateError.message || ''))) {
      return error('المقاول غير موجود', 404);
    }
    if (deactivateError) throw deactivateError;
    return success({ ...((data || {}) as Record<string, unknown>), deactivated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
