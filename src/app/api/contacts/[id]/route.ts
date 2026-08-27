import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getContactBalance } from '@/lib/contact-utils';
import { contactUpdateSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTACT_COLUMNS = 'id, name, type, phone, email, address, tax_number, commercial_registration, credit_limit, contact_person, contact_person_phone, contact_person_email, city, region, country, postal_code, website, iban, bank_name, swift_code, payment_terms, notes, date_of_birth, gender, national_id, category, is_active, created_at, created_by';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'contacts', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الطرف غير صالح');
    const { data: contact, error: queryError } = await sb().from('contacts')
      .select(CONTACT_COLUMNS).eq('id', id).eq('company_id', auth.companyId)
      .eq('is_active', true).is('deleted_at', null).maybeSingle();
    if (queryError) throw queryError;
    if (!contact) return notFound();
    const balance = await getContactBalance(auth.companyId, id);
    return success({ ...contact, balance, balance_type: balance >= 0 ? 'debit' : 'credit' });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'contacts', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الطرف غير صالح');
    const parsed = contactUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    if (!Object.keys(parsed.data).length) return error('لا توجد بيانات للتحديث');

    const { data, error: updateError } = await sb().rpc('update_contact_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (updateError && /الطرف غير موجود/i.test(updateError.message || '')) return notFound();
    if (updateError && /contact plan limit: clients/i.test(updateError.message || '')) return error('تم الوصول للحد الأقصى من العملاء', 403);
    if (updateError && /contact plan limit: suppliers/i.test(updateError.message || '')) return error('تم الوصول للحد الأقصى من الموردين', 403);
    if (updateError && /اسم الطرف مستخدم/i.test(updateError.message || '')) return error('اسم الطرف مستخدم مسبقاً', 409);
    if (updateError && /لا يمكن تغيير نوع طرف/i.test(updateError.message || '')) return error('لا يمكن تغيير نوع طرف مرتبط بمعاملات', 409);
    if (updateError) throw updateError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'contacts', 'delete');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الطرف غير صالح');
    const { data, error: deactivateError } = await sb().rpc('deactivate_contact_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_user_id: auth.userId,
    });
    if (deactivateError && /الطرف غير موجود/i.test(deactivateError.message || '')) return notFound();
    if (deactivateError) throw deactivateError;
    return success({ ...((data || {}) as Record<string, unknown>), deactivated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
