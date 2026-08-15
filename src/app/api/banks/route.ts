import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getAccountBalanceFromJournal } from '@/lib/journal-utils';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'read');
    const s = sb();
    const { page, pageSize } = getPaginationParams(request.url);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await s.from('banks_safes')
      .select('*, accounts(code, name)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .order('type')
      .order('name')
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    // حساب الرصيد لكل بنك/خزينة من القيود المحاسبية
    const banksWithBalance = await Promise.all((data || []).map(async (bs: any) => {
      let openingBalance = parseFloat(bs.opening_balance) || 0;
      let currentBalance = 0;
      
      if (bs.account_id) {
        // حساب الرصيد الحالي من جميع القيود (يشمل الافتتاحي + العمليات) — مقيد بالشركة
        currentBalance = await getAccountBalanceFromJournal(bs.account_id, auth.companyId);
      }

      return {
        ...bs,
        account_code: bs.accounts?.code || null,
        account_name: bs.accounts?.name || null,
        opening_balance: openingBalance,
        current_balance: currentBalance,
        balance: currentBalance,
      };
    }));

    return success({ banks: banksWithBalance, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'create');
    const s = sb();
    const data = await parseBody(request);
    const { name, type, account_number, opening_balance } = data;

    if (!name || !type) return error('name, type are required');
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
      return error('اسم الخزينة/البنك غير صالح');
    }
    if (type !== 'bank' && type !== 'safe') {
      return error('النوع يجب أن يكون bank أو safe');
    }

    const parsedOpeningBalance = opening_balance === undefined || opening_balance === null || opening_balance === '' ? 0 : Number(opening_balance);
    if (!Number.isFinite(parsedOpeningBalance) || Math.abs(parsedOpeningBalance * 100 - Math.round(parsedOpeningBalance * 100)) > 1e-8) return error('الرصيد الافتتاحي غير صالح');
    if (account_number !== undefined && account_number !== null && (typeof account_number !== 'string' || account_number.length > 100)) return error('رقم الحساب غير صالح');

    // Child-code allocation, account + bank creation, optional opening entry,
    // linkage and audit are serialized and committed in one transaction.
    const { data: result, error: createErr } = await s.rpc('create_bank_safe', {
      p_company_id: auth.companyId,
      p_name: name.trim(),
      p_type: type,
      p_account_number: account_number || '',
      p_opening_balance: parsedOpeningBalance,
      p_user_id: auth.userId,
    });
    if (createErr) throw createErr;
    return success(result, 201);
  } catch (err) {
    console.error('Error in POST /api/banks:', err);
    return handleApiError(err);
  }
}
