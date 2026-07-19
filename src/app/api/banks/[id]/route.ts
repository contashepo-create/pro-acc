import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import type { } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getAccountBalanceFromJournal } from '@/lib/journal-utils';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';

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

    // إذا تم تغيير الرصيد الافتتاحي، نحدّث القيد المحاسبي الافتتاحي
    if (body.opening_balance !== undefined && (bankRes as any).account_id) {
      const newOpeningBalance = parseFloat(body.opening_balance) || 0;
      const oldOpeningBalance = parseFloat((bankRes as any).opening_balance) || 0;
      const accountId = (bankRes as any).account_id;
      
      if (newOpeningBalance !== oldOpeningBalance) {
        // البحث عن القيد الافتتاحي الموجود
        const { data: existingJournalEntry } = await s.from('journal_entries')
          .select('id, date')
          .eq('company_id', auth.companyId)
          .eq('type', 'opening_balance')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingJournalEntry) {
          // حذف السطور القديمة للقيد الافتتاحي لهذا الحساب
          await s.from('journal_lines')
            .delete()
            .eq('journal_entry_id', (existingJournalEntry as any).id)
            .eq('account_id', accountId);

          // إذا كان هناك حساب مقابل (رأس المال)، نحدّثه أيضاً
          const { data: capitalAccount } = await s.from('accounts')
            .select('id, code, name')
            .eq('company_id', auth.companyId)
            .eq('code', '3100')
            .maybeSingle();

          // إنشاء سطور جديدة
          const lines: any[] = [];
          
          if (newOpeningBalance > 0) {
            lines.push({
              journal_entry_id: (existingJournalEntry as any).id,
              account_id: accountId,
              debit: newOpeningBalance,
              credit: 0,
              description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
            });
            if (capitalAccount) {
              lines.push({
                journal_entry_id: (existingJournalEntry as any).id,
                account_id: capitalAccount.id,
                debit: 0,
                credit: newOpeningBalance,
                description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
              });
            }
          } else if (newOpeningBalance < 0) {
            lines.push({
              journal_entry_id: (existingJournalEntry as any).id,
              account_id: accountId,
              debit: 0,
              credit: Math.abs(newOpeningBalance),
              description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
            });
            if (capitalAccount) {
              lines.push({
                journal_entry_id: (existingJournalEntry as any).id,
                account_id: capitalAccount.id,
                debit: Math.abs(newOpeningBalance),
                credit: 0,
                description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
              });
            }
          }

          if (lines.length > 0) {
            await insertJournalLines(auth.companyId, lines);
          }
        } else if (newOpeningBalance !== 0) {
          // لا يوجد قيد افتتاحي، ننشئ واحداً
          const jeNum = await getNextJournalNumber(auth.companyId, new Date().toISOString());
          const { data: newEntry } = await s.from('journal_entries')
            .insert({
              company_id: auth.companyId,
              number: jeNum,
              date: new Date().toISOString().split('T')[0],
              type: 'opening_balance',
              description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
              created_by: auth.userId,
            })
            .select('id')
            .single();

          if (newEntry) {
            const { data: capitalAccount } = await s.from('accounts')
              .select('id, code, name')
              .eq('company_id', auth.companyId)
              .eq('code', '3100')
              .maybeSingle();

            const lines: any[] = [];
            
            if (newOpeningBalance > 0) {
              lines.push({
                journal_entry_id: (newEntry as any).id,
                account_id: accountId,
                debit: newOpeningBalance,
                credit: 0,
                description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
              });
              if (capitalAccount) {
                lines.push({
                  journal_entry_id: (newEntry as any).id,
                  account_id: capitalAccount.id,
                  debit: 0,
                  credit: newOpeningBalance,
                  description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
                });
              }
            } else {
              lines.push({
                journal_entry_id: (newEntry as any).id,
                account_id: accountId,
                debit: 0,
                credit: Math.abs(newOpeningBalance),
                description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
              });
              if (capitalAccount) {
                lines.push({
                  journal_entry_id: (newEntry as any).id,
                  account_id: capitalAccount.id,
                  debit: Math.abs(newOpeningBalance),
                  credit: 0,
                  description: `رصيد افتتاحي - ${body.name || (bankRes as any).name}`,
                });
              }
            }

            if (lines.length > 0) {
              await insertJournalLines(auth.companyId, lines);
            }
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
      current_balance: await getAccountBalanceFromJournal(u.account_id || ''),
      balance: await getAccountBalanceFromJournal(u.account_id || ''),
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
