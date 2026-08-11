import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getContactBalances, postContactOpeningBalance } from '@/lib/contact-utils';

const sb = () => getSupabase();

const VALID_CLIENT_TYPES = new Set(['client', 'both']);

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'clients', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const contactId = url.searchParams.get('contactId');

    let query = s.from('contacts')
      .select('*, accounts(code, name)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .in('type', ['client', 'both']);

    if (contactId) {
      query = query.eq('id', contactId);
    }

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('name')
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const clients = (data || []).map((c: any) => ({
      ...c,
      account_code: c.accounts?.code || null,
      account_name: c.accounts?.name || null,
    }));

    // أرصدة حقيقية من سطور القيد الموسومة بـ contact_id (دفعية، مقيدة بالشركة).
    const balanceMap = await getContactBalances(
      auth.companyId,
      clients.map((c: any) => c.id),
    );
    clients.forEach((c: any) => {
      // موجب = العميل مدين لنا (ذمم مدينة مستحقة)
      c.balance = balanceMap[c.id] || 0;
    });

    return success({ clients, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'clients', 'create');
    const s = sb();
    const data = await parseBody(req);

    // تحقق الحقول الجوهرية (الحقول الموسّعة تمرّر كما هي أدناه)
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      return error('اسم العميل مطلوب');
    }
    const type = data.type || 'client';
    if (!VALID_CLIENT_TYPES.has(type)) {
      return error('نوع العميل غير صالح');
    }
    if (data.email && !isValidEmail(data.email)) {
      return error('البريد الإلكتروني غير صالح');
    }

    // Check plan limits
    try {
      const { checkPlanLimit } = await import('@/lib/plan-limits');
      const limitCheck = await checkPlanLimit(auth.companyId, 'clients');
      if (!limitCheck.allowed) {
        return error(limitCheck.message || 'تم الوصول للحد الأقصى من العملاء', 403);
      }
    } catch (e) {
      console.warn('Plan limit check failed:', e);
    }

    const insertData: any = {
      company_id: auth.companyId,
      name: data.name.trim(),
      type,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      tax_number: data.tax_number || null,
      commercial_registration: data.commercial_registration || null,
      credit_limit: data.credit_limit || 0,
      is_active: true,
      created_by: auth.userId,
    };

    // Extended fields (safe — will be ignored if columns don't exist yet)
    const extendedFields = [
      'contact_person', 'contact_person_phone', 'contact_person_email',
      'city', 'region', 'country', 'postal_code', 'website',
      'iban', 'bank_name', 'swift_code',
      'opening_balance', 'opening_balance_type', 'payment_terms',
      'notes', 'date_of_birth', 'gender', 'national_id', 'category',
    ];

    extendedFields.forEach(field => {
      if (data[field] !== undefined) {
        insertData[field] = data[field];
      }
    });

    const { data: result, error: insertError } = await s.from('contacts')
      .insert(insertData)
      .select('*')
      .single();

    if (insertError) throw insertError;

    // رصيد افتتاحي للعميل — قيد متوازن موسوم بـ contact_id
    const openingBalance = parseFloat(data.opening_balance) || 0;
    const openingBalanceType = data.opening_balance_type === 'credit' ? 'credit' : 'debit';
    if (openingBalance !== 0) {
      const { error: obErr } = await postContactOpeningBalance(auth.companyId, {
        contactId: result.id,
        type,
        amount: openingBalance,
        balanceType: openingBalanceType,
        name: data.name.trim(),
        userId: auth.userId,
      });
      if (obErr) {
        await s.from('contacts').delete().eq('id', result.id).eq('company_id', auth.companyId);
        throw obErr;
      }
    }

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
