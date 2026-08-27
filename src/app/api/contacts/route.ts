import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { contactCreateSchema } from '@/lib/validation';

const sb = () => getSupabase();
const CONTACT_TYPES = new Set(['client', 'supplier', 'subcontractor', 'both']);
const CONTACT_COLUMNS = 'id, name, type, phone, email, address, tax_number, commercial_registration, credit_limit, contact_person, contact_person_phone, contact_person_email, city, region, country, postal_code, website, iban, bank_name, swift_code, payment_terms, notes, date_of_birth, gender, national_id, category, is_active, created_at, created_by';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'contacts', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const type = url.searchParams.get('type');
    if (type && !CONTACT_TYPES.has(type)) return error('نوع الطرف غير صالح');

    let query = s.from('contacts').select(CONTACT_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId).eq('is_active', true).is('deleted_at', null);
    if (type === 'supplier') query = query.in('type', ['supplier', 'both']);
    else if (type === 'client') query = query.in('type', ['client', 'both']);
    else if (type) query = query.eq('type', type);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('name').range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    return success({ contacts: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'contacts', 'create');
    const parsed = contactCreateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { opening_balance = 0, opening_balance_type = 'debit', ...contact } = parsed.data;

    const { data, error: createError } = await sb().rpc('create_contact_atomic', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_data: contact,
      p_opening_amount: opening_balance,
      p_opening_type: opening_balance_type,
    });
    if (createError && /contact plan limit: clients/i.test(createError.message || '')) {
      return error('تم الوصول للحد الأقصى من العملاء في باقتك الحالية', 403);
    }
    if (createError && /contact plan limit: suppliers/i.test(createError.message || '')) {
      return error('تم الوصول للحد الأقصى من الموردين في باقتك الحالية', 403);
    }
    if (createError && /اسم الطرف مستخدم/i.test(createError.message || '')) return error('اسم الطرف مستخدم مسبقاً', 409);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
