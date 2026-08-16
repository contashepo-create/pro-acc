import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getContactBalances } from '@/lib/contact-utils';
import { contactCreateSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_COLUMNS = 'id, name, type, phone, email, address, tax_number, commercial_registration, credit_limit, contact_person, contact_person_phone, contact_person_email, city, region, country, postal_code, website, iban, bank_name, swift_code, payment_terms, notes, date_of_birth, gender, national_id, category, created_at';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'clients', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const contactId = url.searchParams.get('contactId');
    if (contactId && !UUID_RE.test(contactId)) return error('معرّف العميل غير صالح');

    let query = s.from('contacts').select(CLIENT_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId).in('type', ['client', 'both'])
      .eq('is_active', true).is('deleted_at', null);
    if (contactId) query = query.eq('id', contactId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('name').range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const clients = (data || []) as Array<Record<string, unknown>>;
    const balanceMap = await getContactBalances(auth.companyId, clients.map((client) => String(client.id)));
    const result = clients.map((client) => ({ ...client, balance: balanceMap[String(client.id)] || 0 }));
    return success({ clients: result, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'clients', 'create');
    const raw = await parseBody<Record<string, unknown>>(req);
    const parsed = contactCreateSchema.safeParse({ ...raw, type: raw.type || 'client' });
    if (!parsed.success) return error(parsed.error.issues[0].message);
    if (!['client', 'both'].includes(parsed.data.type)) return error('قسم العملاء يقبل عميلاً أو عميلاً ومورداً فقط');
    const { opening_balance = 0, opening_balance_type = 'debit', ...contact } = parsed.data;
    const { data, error: createError } = await sb().rpc('create_contact_atomic', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_data: contact,
      p_opening_amount: opening_balance,
      p_opening_type: opening_balance_type,
    });
    if (createError && /contact plan limit: clients/i.test(createError.message || '')) return error('تم الوصول للحد الأقصى من العملاء في باقتك الحالية', 403);
    if (createError && /contact plan limit: suppliers/i.test(createError.message || '')) return error('تم الوصول للحد الأقصى من الموردين في باقتك الحالية', 403);
    if (createError && /اسم الطرف مستخدم/i.test(createError.message || '')) return error('اسم العميل مستخدم مسبقاً', 409);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
