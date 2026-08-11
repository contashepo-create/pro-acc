import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { contactCreateSchema } from '@/lib/validation';
import { postContactOpeningBalance } from '@/lib/contact-utils';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'contacts', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const type = url.searchParams.get('type');

    let query = s.from('contacts')
      .select('*, accounts(code, name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (type) {
      query = query.eq('type', type);
    }

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('name')
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const contacts = (data || []).map((c: any) => ({
      ...c,
      account_code: c.accounts?.code || null,
      account_name: c.accounts?.name || null,
    }));

    return success({ contacts, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'contacts', 'create');
    const s = sb();
    const data = await parseBody(req);

    const parsed = contactCreateSchema.safeParse(data);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { name, type, phone, email, address, tax_number, commercial_registration, credit_limit } = parsed.data;

    // Check plan limits based on contact type
    if (type === 'client' || type === 'supplier') {
      try {
        const { checkPlanLimit } = await import('@/lib/plan-limits');
        const limitCheck = await checkPlanLimit(auth.companyId, type === 'client' ? 'clients' : 'suppliers');
        if (!limitCheck.allowed) {
          return error(limitCheck.message || `تم الوصول للحد الأقصى من ${type === 'client' ? 'العملاء' : 'الموردين'}`, 403);
        }
      } catch (e) {
        console.warn('Plan limit check failed:', e);
      }
    }

    const { data: result, error: insertError } = await s.from('contacts')
      .insert({
        company_id: auth.companyId,
        name,
        type,
        phone: phone || null,
        email: email || null,
        address: address || null,
        tax_number: tax_number || null,
        commercial_registration: commercial_registration || null,
        credit_limit: credit_limit || 0,
        is_active: true,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertError) throw insertError;

    // رصيد افتتاحي اختياري للطرف — يُرحَّل كقيد متوازن موسوم بـ contact_id
    const openingBalance = parseFloat((data as any).opening_balance) || 0;
    const openingBalanceType = (data as any).opening_balance_type === 'credit' ? 'credit' : 'debit';
    if (openingBalance !== 0) {
      const { error: obErr } = await postContactOpeningBalance(auth.companyId, {
        contactId: result.id,
        type,
        amount: openingBalance,
        balanceType: openingBalanceType,
        name,
        userId: auth.userId,
      });
      if (obErr) {
        // فشل القيد الافتتاحي يلغي إنشاء الطرف (لا طرف برصيد غير مُرحَّل)
        await s.from('contacts').delete().eq('id', result.id).eq('company_id', auth.companyId);
        throw obErr;
      }
    }

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
