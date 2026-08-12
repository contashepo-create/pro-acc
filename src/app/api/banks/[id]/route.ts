import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getAccountBalanceFromJournal, insertJournalHeader, insertJournalLines } from '@/lib/journal-utils';

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

    if (queryError || !bankRes) {
      return notFound();
    }

    const bank = bankRes as Record<string, any>;
    let currentBalance = 0;
    let openingBalance = 0;

    if (bank.account_id) {
      // الرصيد الحالي = كل القيود (افتتاحي + عمليات)
      currentBalance = await getAccountBalanceFromJournal(bank.account_id, auth.companyId);

      // الرصيد الافتتاحي = قيود من نوع opening_balance فقط
      const { data: openingLines } = await s.from('journal_lines')
        .select('debit, credit, journal_entries!inner(type)')
        .eq('account_id', bank.account_id)
        .eq('company_id', auth.companyId);

      if (openingLines) {
        openingBalance = (openingLines as any[])
          .filter((l: any) => l.journal_entries?.type === 'opening_balance')
          .reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0), 0);
      }
    }

    // الرصيد الافتتاحي من عمود banks_safes (المحفوظ) له أولوية
    const savedOpeningBalance = parseFloat(bank.opening_balance) || 0;

    return success({
      ...bank,
      account_code: bank.accounts?.code || null,
      account_name: bank.accounts?.name || null,
      opening_balance: savedOpeningBalance > 0 ? savedOpeningBalance : openingBalance,
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
    if (body.opening_balance !== undefined) updateData.opening_balance = parseFloat(body.opening_balance) || 0;

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await s.from('banks_safes')
        .update(updateData)
        .eq('id', id);
      if (updateError) throw updateError;
    }

    // إذا تم تغيير الرصيد الافتتاحي، نحدّث قيد الافتتاح الخاص بهذا البنك فقط
    // (البحث السابق كان يلتقط "أحدث قيد افتتاحي بالشركة" — قيد بنكٍ آخر! —
    // ويحذف سطر البنك فقط تاركاً سطر رأس المال → قيد غير متوازن)
    if (body.opening_balance !== undefined && (bankRes as any).account_id) {
      const newOpeningBalance = parseFloat(body.opening_balance) || 0;
      const oldOpeningBalance = parseFloat((bankRes as any).opening_balance) || 0;
      const accountId = (bankRes as any).account_id;
      const bankName = body.name || (bankRes as any).name;

      if (newOpeningBalance !== oldOpeningBalance) {
        // حساب رأس المال إلزامي لأي رصيد غير صفري — بلا مقابل لا قيد متوازن
        const { data: capitalAccount } = await s.from('accounts')
          .select('id, code, name')
          .eq('company_id', auth.companyId)
          .eq('code', '3100')
          .maybeSingle();

        if (newOpeningBalance !== 0 && !capitalAccount) {
          return error('حساب رأس المال (3100) مفقود — لا يمكن ترحيل رصيد افتتاحي متوازن');
        }

        // قيد الافتتاح الخاص بهذا البنك تحديداً: نستدل عليه من سطور حسابه
        const { data: ownLines } = await s.from('journal_lines')
          .select('journal_entry_id')
          .eq('account_id', accountId)
          .eq('company_id', auth.companyId);
        const ownJeIds = [...new Set((ownLines || []).map((l: any) => l.journal_entry_id))];

        let openingEntryId: string | null = null;
        if (ownJeIds.length > 0) {
          const { data: obEntries } = await s.from('journal_entries')
            .select('id')
            .eq('company_id', auth.companyId)
            .eq('type', 'opening_balance')
            .in('id', ownJeIds)
            .limit(1);
          openingEntryId = obEntries?.[0]?.id || null;
        }

        if (!openingEntryId && newOpeningBalance !== 0) {
          // لا قيد افتتاحي لهذا البنك — ننشئ واحداً جديداً
          const { data: newEntry, error: newEntryErr } = await insertJournalHeader(auth.companyId, {
            date: new Date().toISOString().split('T')[0],
            type: 'opening_balance',
            description: `رصيد افتتاحي - ${bankName}`,
            created_by: auth.userId,
          });
          if (newEntryErr || !newEntry) throw newEntryErr || new Error('فشل قيد الافتتاح');
          openingEntryId = newEntry.id;
        }

        if (openingEntryId) {
          // إعادة كتابة سطري الطرفين (بنك + رأس مال) — القيد يبقى متوازناً دائماً
          const affectedAccountIds = capitalAccount ? [accountId, capitalAccount.id] : [accountId];
          await s.from('journal_lines')
            .delete()
            .eq('journal_entry_id', openingEntryId)
            .in('account_id', affectedAccountIds);

          const lines: any[] = [];
          if (newOpeningBalance > 0 && capitalAccount) {
            lines.push(
              { journal_entry_id: openingEntryId, account_id: accountId, debit: newOpeningBalance, credit: 0, description: `رصيد افتتاحي - ${bankName}` },
              { journal_entry_id: openingEntryId, account_id: capitalAccount.id, debit: 0, credit: newOpeningBalance, description: `رصيد افتتاحي - ${bankName}` },
            );
          } else if (newOpeningBalance < 0 && capitalAccount) {
            lines.push(
              { journal_entry_id: openingEntryId, account_id: accountId, debit: 0, credit: Math.abs(newOpeningBalance), description: `رصيد افتتاحي - ${bankName}` },
              { journal_entry_id: openingEntryId, account_id: capitalAccount.id, debit: Math.abs(newOpeningBalance), credit: 0, description: `رصيد افتتاحي - ${bankName}` },
            );
          }

          if (lines.length > 0) {
            const { error: linesErr } = await insertJournalLines(auth.companyId, lines);
            if (linesErr) throw linesErr;
          }
        }
      }
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
      opening_balance: parseFloat(u.opening_balance) || 0,
      current_balance: u.account_id ? await getAccountBalanceFromJournal(u.account_id, auth.companyId) : 0,
      balance: u.account_id ? await getAccountBalanceFromJournal(u.account_id, auth.companyId) : 0,
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
