import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getContactBalance } from '@/lib/contact-utils';
import { contactUpdateSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_COLUMNS = 'id, name, type, phone, email, address, tax_number, commercial_registration, credit_limit, contact_person, contact_person_phone, contact_person_email, city, region, country, postal_code, website, iban, bank_name, swift_code, payment_terms, notes, date_of_birth, gender, national_id, category, created_at';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'clients', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف العميل غير صالح');
    const { data: client, error: queryError } = await sb().from('contacts')
      .select(CLIENT_COLUMNS).eq('id', id).eq('company_id', auth.companyId)
      .in('type', ['client', 'both']).eq('is_active', true).is('deleted_at', null).maybeSingle();
    if (queryError) throw queryError;
    if (!client) return notFound();
    const balance = await getContactBalance(auth.companyId, id);
    return success({ ...client, balance, balance_type: balance >= 0 ? 'debit' : 'credit' });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'clients', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف العميل غير صالح');
    const parsed = contactUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    if (!Object.keys(parsed.data).length) return error('لا توجد بيانات للتحديث');
    if (parsed.data.type && !['client', 'both'].includes(parsed.data.type)) {
      return error('قسم العملاء يقبل عميلاً أو عميلاً ومورداً فقط');
    }
    const { data, error: updateError } = await sb().rpc('update_contact_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (updateError && /الطرف غير موجود/i.test(updateError.message || '')) return notFound();
    if (updateError && /contact plan limit/i.test(updateError.message || '')) return error('تم الوصول لحد الأطراف في الباقة الحالية', 403);
    if (updateError && /اسم الطرف مستخدم/i.test(updateError.message || '')) return error('اسم العميل مستخدم مسبقاً', 409);
    if (updateError && /لا يمكن تغيير نوع طرف/i.test(updateError.message || '')) return error('لا يمكن تغيير نوع عميل مرتبط بمعاملات', 409);
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
    const auth = await requireModulePermission(request, 'clients', 'delete');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف العميل غير صالح');
    const s = sb();
    const { data: client, error: clientError } = await s.from('contacts').select('id')
      .eq('id', id).eq('company_id', auth.companyId).in('type', ['client', 'both']).maybeSingle();
    if (clientError) throw clientError;
    if (!client) return notFound();
    const { data, error: deactivateError } = await s.rpc('deactivate_contact_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_user_id: auth.userId,
    });
    if (deactivateError) throw deactivateError;
    return success({ ...((data || {}) as Record<string, unknown>), deactivated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
