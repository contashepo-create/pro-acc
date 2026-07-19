import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createAutoAccount } from '@/lib/auto-account';
import { getAccountBalanceFromJournal } from '@/lib/journal-utils';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
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
      let openingBalance = 0;
      let currentBalance = 0;
      
      if (bs.account_id) {
        // حساب الرصيد الحالي من جميع القيود (يشمل الافتتاحي + العمليات)
        currentBalance = await getAccountBalanceFromJournal(bs.account_id);
        
        // حساب الرصيد الافتتاحي من القيود من نوع opening_balance فقط
        const { data: openingLines } = await s.from('journal_lines')
          .select('debit, credit, journal_entries!inner(type)')
          .eq('account_id', bs.account_id);
        
        if (openingLines) {
          openingBalance = openingLines
            .filter((l: any) => l.journal_entries?.type === 'opening_balance')
            .reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0), 0);
        }
      }

      return {
        ...bs,
        account_code: bs.accounts?.code || null,
        account_name: bs.accounts?.name || null,
        opening_balance: openingBalance,   // الرصيد الافتتاحي (من قيود افتتاحية فقط)
        current_balance: currentBalance,    // الرصيد الحالي (من كل القيود)
        balance: currentBalance,            // للتوافق مع الواجهة
      };
    }));

    return success({ banks: banksWithBalance, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const data = await parseBody(request);
    const { name, type, account_number, opening_balance } = data;

    if (!name || !type) return error('name, type are required');

    const parsedOpeningBalance = parseFloat(opening_balance) || 0;

    // Create auto account in chart of accounts
    const accountCode = `${type === 'bank' ? '1120' : '1110'}-${Date.now().toString().slice(-4)}`;
    const parentCode = type === 'bank' ? '1120' : '1110';
    
    console.log(`Creating auto account for bank/safe: ${name} with code ${accountCode}`);
    
    const newAccount = await createAutoAccount({
      companyId: auth.companyId,
      code: accountCode,
      name: name,
      type: 'asset',
      parentCode: parentCode,
      openingBalance: parsedOpeningBalance,
    });

    if (!newAccount) {
      console.error('Failed to create auto account for bank/safe');
      return error('فشل إنشاء الحساب المحاسبي للبنك/الصندوق. تأكد من وجود الحساب الأب في شجرة الحسابات');
    }

    console.log(`Auto account created successfully: ${newAccount.id}`);

    // Create bank/safe and link to account (without opening_balance - it's tracked in journal)
    const { data: result, error: insertError } = await s.from('banks_safes')
      .insert({
        company_id: auth.companyId,
        name,
        type,
        account_number: account_number || null,
        account_id: newAccount.id,
        is_active: true,
      })
      .select('*')
      .single();

    if (insertError) {
      console.error('Failed to create bank/safe:', insertError);
      throw insertError;
    }

    console.log(`Bank/safe created successfully: ${result.id}`);

    return success({
      ...result,
      account_code: newAccount.code,
      account_name: newAccount.name,
      opening_balance: parsedOpeningBalance,
      current_balance: parsedOpeningBalance,
      balance: parsedOpeningBalance,
    }, 201);
  } catch (err) {
    console.error('Error in POST /api/banks:', err);
    return handleApiError(err);
  }
}
