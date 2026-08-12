import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getContactBalances, postContactOpeningBalance } from '@/lib/contact-utils';
import { pickContactFields, writeContact } from '@/lib/contact-fields';

const sb = () => getSupabase();

const VALID_CLIENT_TYPES = new Set(['client', 'both', 'supplier']);

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

    const balanceMap = await getContactBalances(
      auth.companyId,
      clients.map((c: any) => c.id),
    );
    clients.forEach((c: any) => {
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

    const picked = pickContactFields(data, { requireName: true });
    if (picked.error || !picked.data) return error(picked.error || 'اسم العميل مطلوب');
    const type = picked.data.type || 'client';
    if (!VALID_CLIENT_TYPES.has(type)) {
      return error('نوع العميل غير صالح');
    }

    try {
      const { checkPlanLimit } = await import('@/lib/plan-limits');
      const limitCheck = await checkPlanLimit(auth.companyId, 'clients');
      if (!limitCheck.allowed) {
        return error(limitCheck.message || 'تم الوصول للحد الأقصى من العملاء', 403);
      }
    } catch (e) {
      console.warn('Plan limit check failed:', e);
    }

    const { data: result, error: insertError } = await writeContact(s, 'insert', {
      ...picked.data,
      type,
      created_by: auth.userId,
    }, { companyId: auth.companyId });

    if (insertError || !result) throw insertError || new Error('فشل حفظ العميل');

    const openingBalance = parseFloat(data.opening_balance) || 0;
    const openingBalanceType = data.opening_balance_type === 'credit' ? 'credit' : 'debit';
    if (openingBalance !== 0) {
      const { error: obErr } = await postContactOpeningBalance(auth.companyId, {
        contactId: result.id,
        type,
        amount: openingBalance,
        balanceType: openingBalanceType,
        name: picked.data.name,
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
