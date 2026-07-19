import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import type { } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getAccountBalanceFromJournal } from '@/lib/journal-utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: bankRes, error: queryError } = await s.from('banks_safes')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryError || !bankRes) {
      return notFound();
    }

    const bank = bankRes as Record<string, any>;
    let currentBalance = 0;
    let openingBalance = 0;

    if (bank.account_id) {
      // الرصيد الحالي = كل القيود (افتتاحي + عمليات)
      currentBalance = await getAccountBalanceFromJournal(bank.account_id);
      
      // الرصيد الافتتاحي = قيود من نوع opening_balance فقط
      const { data: openingLines } = await s.from('journal_lines')
        .select('debit, credit, journal_entries!inner(type)')
        .eq('account_id', bank.account_id);
      
      if (openingLines) {
        openingBalance = (openingLines as any[])
          .filter((l: any) => l.journal_entries?.type === 'opening_balance')
          .reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0), 0);
      }
    }

    return success({
      ...bank,
      account_code: bank.accounts?.code || null,
      account_name: bank.accounts?.name || null,
      opening_balance: openingBalance,   // الرصيد الافتتاحي فقط
      current_balance: currentBalance,    // الرصيد الحالي (يشمل كل العمليات)
      balance: currentBalance,            // للتوافق مع الواجهة القديمة
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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: bankRes } = await s.from('banks_safes')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!bankRes) {
      return notFound();
    }

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.account_number !== undefined) updateData.account_number = body.account_number;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await s.from('banks_safes')
        .update(updateData)
        .eq('id', id);
      if (updateError) throw updateError;
    }

    const { data: updated, error: fetchError } = await s.from('banks_safes')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const u = updated as Record<string, any>;
    return success({
      ...u,
      account_code: u.accounts?.code || null,
      account_name: u.accounts?.name || null,
    });
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
    const s = sb();

    const { data: bankRes } = await s.from('banks_safes')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!bankRes) {
      return notFound();
    }

    const { data: txDep } = await s.from('cash_transactions')
      .select('id')
      .eq('bank_safe_id', id)
      .limit(1);
    if (txDep && txDep.length > 0) {
      return error('لا يمكن حذف الخزينة/البنك لأنه مرتبط بحركات نقدية');
    }

    const { data: vouchDep } = await s.from('voucher_receipts')
      .select('id')
      .eq('bank_safe_id', id)
      .limit(1);
    if (vouchDep && vouchDep.length > 0) {
      return error('لا يمكن حذف الخزينة/البنك لأنه مرتبط بسندات قبض');
    }

    const { data: vouchDisDep } = await s.from('voucher_disbursements')
      .select('id')
      .eq('bank_safe_id', id)
      .limit(1);
    if (vouchDisDep && vouchDisDep.length > 0) {
      return error('لا يمكن حذف الخزينة/البنك لأنه مرتبط بسندات صرف');
    }

    const { error: deleteError } = await s.from('banks_safes')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
