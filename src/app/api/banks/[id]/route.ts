import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getAccountBalanceFromJournal } from '@/lib/journal-utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'read');
    const { id } = await params;
    const s = sb();

    const { data: bankRes, error: queryError } = await s.from('banks_safes')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryError) throw queryError;
    if (!bankRes) return notFound();

    const bank = bankRes as Record<string, any>;
    let currentBalance = 0;
    let openingBalance = 0;

    if (bank.account_id) {
      // الرصيد الحالي = كل القيود (افتتاحي + عمليات)
      currentBalance = await getAccountBalanceFromJournal(bank.account_id, auth.companyId);

      const { data: opening, error: openingError } = await s.rpc('get_account_balance', {
        p_company_id: auth.companyId, p_account_id: bank.account_id,
        p_journal_type: 'opening_balance', p_as_of: null,
      });
      if (openingError) throw openingError;
      openingBalance = Number(opening) || 0;
    }

    return success({
      ...bank,
      account_code: bank.accounts?.code || null,
      account_name: bank.accounts?.name || null,
      configured_opening_balance: parseFloat(bank.opening_balance) || 0,
      opening_balance: openingBalance,
      current_balance: currentBalance,
      balance: currentBalance,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'update');
    const { id } = await params;
    const s = sb();
    const body = await parseBody<Record<string, any>>(request);
    const { data: bank, error: bankErr } = await s.from('banks_safes').select('id, opening_balance')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (bankErr) throw bankErr;
    if (!bank) return notFound();
    if (body.opening_balance !== undefined && Number(body.opening_balance) !== Number((bank as any).opening_balance || 0)) {
      return error('الرصيد الافتتاحي المرحّل غير قابل للتعديل؛ استخدم قيد تصحيح عكسياً', 409);
    }
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) return error('اسم البنك/الخزينة غير صالح');
      update.name = body.name.trim();
    }
    if (body.type !== undefined) {
      return error('لا يمكن تغيير نوع البنك/الخزينة بعد إنشاء حسابه المحاسبي', 409);
    }
    if (body.account_number !== undefined) {
      if (body.account_number !== null && (typeof body.account_number !== 'string' || body.account_number.length > 100)) return error('رقم الحساب غير صالح');
      update.account_number = body.account_number?.trim() || null;
    }
    if (body.is_active !== undefined) {
      if (body.is_active !== true) return error('استخدم عملية التعطيل المخصصة بعد تصفير الرصيد', 409);
      update.is_active = true;
    }
    if (!Object.keys(update).length) return error('لا توجد حقول قابلة للتعديل');
    const { data: updated, error: updateError } = await s.from('banks_safes')
      .update(update).eq('id', id).eq('company_id', auth.companyId)
      .select('*, accounts(code, name)').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return notFound();
    const row = updated as Record<string, any>;
    const balance = row.account_id ? await getAccountBalanceFromJournal(row.account_id, auth.companyId) : 0;
    return success({ ...row, account_code: row.accounts?.code || null, account_name: row.accounts?.name || null, current_balance: balance, balance });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const { data, error: deactivateErr } = await sb().rpc('deactivate_bank_safe', {
      p_company_id: auth.companyId,
      p_bank_safe_id: id,
      p_user_id: auth.userId,
    });
    if (deactivateErr) {
      if (String(deactivateErr.message || '').includes('غير موجود')) return notFound();
      throw deactivateErr;
    }
    return success({ deactivated: true, bank: data });
  } catch (err) {
    return handleApiError(err);
  }
}
