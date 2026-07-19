import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const employeeId = url.searchParams.get('employeeId');

    let query = s.from('custodies')
      .select('*, employees(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (employeeId) query = query.eq('employee_id', employeeId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);
    
    if (queryError) throw queryError;

    const custodies = (data || []).map((c: any) => ({
      ...c, 
      employee_name: c.employees?.name || null,
    }));
    return success({ custodies, total: count || 0, page, pageSize });
  } catch (err) { 
    console.error('Custodies GET error:', err);
    return handleApiError(err); 
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { employee_id, date, amount, reason, bank_safe_id } = data;
    
    if (!employee_id || !date || !amount)
      return error('الموظف والتاريخ والمبلغ مطلوب');

    const parsedAmount = parseFloat(amount);
    const companyId = auth.companyId;
    const userId = auth.userId;

    // إنشاء العهدة
    const { data: custody, error: cErr } = await s.from('custodies')
      .insert({ 
        company_id: companyId, 
        employee_id, 
        date, 
        amount: parsedAmount, 
        remaining_amount: parsedAmount, // المبلغ المتبقي = المبلغ كاملاً في البداية
        reason: reason || 'عهدة موظف',
        bank_safe_id: bank_safe_id || null,
        status: 'open',
        created_by: userId,
      })
      .select('*')
      .single();
    
    if (cErr) {
      console.error('Custody insert error:', cErr);
      throw cErr;
    }

    // إنشاء القيد المحاسبي للعهدة
    // مدين: عهد الموظفين (1150) / دائن: البنك/الخزينة
    const { data: custAcc } = await s.from('accounts')
      .select('id, code, name')
      .eq('company_id', companyId)
      .eq('code', ACCOUNT_CODES.EMPLOYEE_CUSTODIES)
      .maybeSingle();

    let bankAccountId: string | null = null;
    
    // إذا تم تحديد بنك/خزينة
    if (bank_safe_id) {
      const { data: bankAcc } = await s.from('banks_safes')
        .select('account_id')
        .eq('id', bank_safe_id)
        .maybeSingle();
      bankAccountId = bankAcc?.account_id || null;
    }

    // إذا لم يتم تحديد بنك، استخدم حساب النقدية
    if (!bankAccountId && custAcc) {
      const { data: cashAcc } = await s.from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', ACCOUNT_CODES.CASH)
        .maybeSingle();
      bankAccountId = cashAcc?.id || null;
    }

    if (custAcc && bankAccountId) {
      const jeNum = await getNextJournalNumber(companyId, date || new Date().toISOString());
      const { data: je, error: jeErr } = await s.from('journal_entries')
        .insert({ 
          company_id: companyId, 
          number: jeNum, 
          date, 
          type: 'general', 
          description: `عهدة موظف: ${reason || ''}`, 
          created_by: userId 
        })
        .select('id')
        .single();

      if (jeErr) {
        console.error('Journal entry error for custody:', jeErr);
      } else if (je) {
        // تحديث العهدة برابط القيد
        await s.from('custodies')
          .update({ journal_entry_id: je.id })
          .eq('id', custody.id);

        // إدراج سطور القيد
        const { error: jlErr } = await insertJournalLines(companyId, [
          { journal_entry_id: je.id, account_id: custAcc.id, debit: parsedAmount, credit: 0 },
          { journal_entry_id: je.id, account_id: bankAccountId, debit: 0, credit: parsedAmount },
        ]);
        
        if (jlErr) {
          console.error('Journal lines error for custody:', jlErr);
        }
      }
    }

    return success(custody, 201);
  } catch (err) { 
    console.error('Custodies POST error:', err);
    return handleApiError(err); 
  }
}
