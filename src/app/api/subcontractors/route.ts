import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, parseBody, getPaginationParams, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const subcontractorSchema = z.object({
  name: z.string().trim().min(1, 'الاسم مطلوب').max(200),
  contact_person: z.string().trim().max(200).optional().nullable(),
  specialty: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email('البريد الإلكتروني غير صالح').max(254).optional().nullable().or(z.literal('')),
  tax_number: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1600).optional().nullable(),
}).strict();
const COLUMNS = 'id, name, type, phone, email, tax_number, contact_person, notes, is_active, created_at';

function contactPayload(data: z.infer<typeof subcontractorSchema>) {
  const notes = [data.specialty ? `التخصص: ${data.specialty}` : '', data.notes || '']
    .filter(Boolean).join(' | ');
  return {
    name: data.name,
    type: 'subcontractor' as const,
    contact_person: data.contact_person || null,
    phone: data.phone || null,
    email: data.email || null,
    tax_number: data.tax_number || null,
    notes: notes || null,
  };
}

function subcontractorView(contact: Record<string, unknown>) {
  const parts = String(contact.notes || '').split('|').map((part) => part.trim()).filter(Boolean);
  const specialty = (parts.find((part) => part.startsWith('التخصص:')) || '').replace('التخصص:', '').trim();
  const legacyContactPerson = (parts.find((part) => part.startsWith('شخص الاتصال:')) || '').replace('شخص الاتصال:', '').trim();
  const notes = parts.filter((part) => !part.startsWith('التخصص:') && !part.startsWith('شخص الاتصال:')).join(' | ');
  return { ...contact, specialty, contact_person: contact.contact_person || legacyContactPerson, notes };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'read');
    const { page, pageSize } = getPaginationParams(request.url);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await sb().from('contacts')
      .select(COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId)
      .eq('type', 'subcontractor')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name')
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    return success({ subcontractors: (data || []).map((row) => subcontractorView(row)), total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'subcontractors', 'create');
    const parsed = subcontractorSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_contact_atomic', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_data: contactPayload(parsed.data),
      p_opening_amount: 0,
      p_opening_type: 'credit',
    });
    const message = String(createError?.message || '');
    if (message.includes('contact plan limit: suppliers')) return error('تم الوصول للحد الأقصى من الموردين والمقاولين', 403);
    if (message.includes('اسم الطرف مستخدم')) return error('اسم المقاول مستخدم مسبقاً', 409);
    if (createError) throw createError;
    return success({ subcontractor: data }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
