import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError, requireManagerOrAbove } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextVoucherNumber, getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { checkApprovalThreshold, sendTransactionNotification } from '@/lib/notifications';
import { insertJournalLines, getAccountBalanceFromJournal } from '@/lib/journal-utils';
import { canBypassTelegramConfirmation } from '@/lib/permissions';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const disbType = url.searchParams.get('disbursementType');

    let data, count, queryError;
    try {
      let query = s.from('voucher_disbursements')
        .select('*, contacts(name), employees(name), banks_safes(name), journal_entries(number)', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (disbType) query = query.eq('disbursement_type', disbType);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      count = result.count;
      queryError = result.error;
    } catch (joinErr) {
      console.warn('Disbursement GET with joins failed, trying simple:', joinErr);
      let query = s.from('voucher_disbursements')
        .select('*', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (disbType) query = query.eq('disbursement_type', disbType);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      count = result.count;
      queryError = result.error;
    }

    if (queryError) throw queryError;

    const disbursements = (data || []).map((vd: any) => ({
      ...vd, 
      contact_name: vd.contacts?.name || null, 
      employee_name: vd.employees?.name || null,
      bank_name: vd.banks_safes?.name || null, 
      journal_entry_number: vd.journal_entries?.number || null,
    }));

    return success({ disbursements, total: count || 0, page, pageSize });
  } catch (err) {
    console.error('Disbursement GET error:', err);
    return success({ disbursements: [], total: 0, page: 1, pageSize: 50 });
  }
}

/**
 * حساب رصيد البنك/الخزينة الحالي من القيود المحاسبية
 * الرصيد الحالي = مجموع المدين - مجموع الدائن في حساب البنك
 */
async function getCurrentBankBalance(bankSafeId: string): Promise<{ balance: number; accountId: string | null }> {
  const s = sb();

  const { data: bank } = await s.from('banks_safes')
    .select('account_id, name')
    .eq('id', bankSafeId)
    .maybeSingle();

  if (!bank?.account_id) {
    return { balance: 0, accountId: null };
  }

  // حساب الرصيد من جميع القيود المحاسبية (يشمل الرصيد الافتتاحي + كل العمليات)
  const balance = await getAccountBalanceFromJournal(bank.account_id);

  return { balance, accountId: bank.account_id };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const data = await parseBody(request);
    const { date, disbursement_type, contact_id, employee_id, amount, bank_safe_id, reason, invoice_items, account_id } = data;

    if (!date || !disbursement_type || !amount || !bank_safe_id || !reason)
      return error('التاريخ ونوع السند والمبلغ والبنك/الخزينة والبيان مطلوب');

    const companyId = auth.companyId;
    const userId = auth.userId;

    // ✅ التحقق من رصيد البنك/الخزينة - الرصيد الحالي من القيود المحاسبية
    const { balance: currentBalance, accountId: bankAccountId } = await getCurrentBankBalance(bank_safe_id);
    
    if (!bankAccountId) {
      return error('الحساب البنكي غير موجود لهذا البنك/الخزينة. يرجى ربط البنك بحساب محاسبي');
    }

    const parsedAmount = parseFloat(amount);
    if (currentBalance < parsedAmount) {
      return error(`الرصيد غير كافٍ. الرصيد الحالي: ${currentBalance.toFixed(2)} ر.س، المبلغ المطلوب: ${parsedAmount.toFixed(2)} ر.س`);
    }

    // ✅ التحقق من حد الموافقة وإرسال تنبيه إذا لزم الأمر
    const approvalCheck = await checkApprovalThreshold(companyId, parsedAmount, 'voucher_disbursement', userId);
    if (approvalCheck.requiresApproval) {
      console.log(`Approval required for disbursement: ${parsedAmount} (threshold exceeded)`);
    }

    const nextNum = await getNextVoucherNumber(companyId, 'voucher_disbursements');

    // إنشاء القيد المحاسبي
    const jeNum = await getNextJournalNumber(companyId, date);
    const { data: je, error: jeErr } = await s.from('journal_entries')
      .insert({ 
        company_id: companyId, 
        number: jeNum, 
        date, 
        type: 'general', 
        description: `سند صرف: ${reason}`, 
        created_by: userId 
      })
      .select('id')
      .single();

    if (jeErr) {
      console.error('Journal entry creation error:', jeErr);
      throw jeErr;
    }
    const jeId = je.id;

    // إنشاء سطور القيد باستخدام الدالة المساعدة
    const linesInput: any[] = [];
    
    // دائن: البنك/الخزينة
    linesInput.push({ 
      journal_entry_id: jeId, 
      account_id: bankAccountId, 
      debit: 0, 
      credit: parsedAmount 
    });

    // مدين: الحساب المقابل بناءً على نوع السند
    let counterpartAccountId: string | null = null;

    if (disbursement_type === 'supplier' || disbursement_type === 'supplier_advance') {
      const { data: apAcc } = await s.from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE)
        .maybeSingle();
      counterpartAccountId = apAcc?.id || null;
    } else if (disbursement_type === 'client_refund') {
      const { data: arAcc } = await s.from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', ACCOUNT_CODES.ACCOUNTS_RECEIVABLE)
        .maybeSingle();
      counterpartAccountId = arAcc?.id || null;
    } else if (disbursement_type === 'employee_advance') {
      const { data: advAcc } = await s.from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', ACCOUNT_CODES.EMPLOYEE_ADVANCES)
        .maybeSingle();
      counterpartAccountId = advAcc?.id || null;
      
      if (employee_id) {
        await s.from('employee_advances')
          .insert({ 
            company_id: companyId, 
            employee_id, 
            date, 
            type: 'advance', 
            amount: parsedAmount, 
            description: reason 
          });
      }
    } else if (disbursement_type === 'subcontractor') {
      const { data: subAcc } = await s.from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES)
        .maybeSingle();
      counterpartAccountId = subAcc?.id || null;
    } else if (account_id) {
      counterpartAccountId = account_id;
    }

    if (counterpartAccountId) {
      linesInput.push({ 
        journal_entry_id: jeId, 
        account_id: counterpartAccountId, 
        debit: parsedAmount, 
        credit: 0 
      });
    }

    const { error: jlErr } = await insertJournalLines(companyId, linesInput);
    if (jlErr) {
      console.error('Journal lines insert error:', jlErr);
      throw jlErr;
    }

    // حفظ السند
    const { data: vd, error: vdErr } = await s.from('voucher_disbursements')
      .insert({ 
        company_id: companyId, 
        number: nextNum, 
        date, 
        disbursement_type, 
        contact_id: contact_id || null, 
        employee_id: employee_id || null, 
        amount: parsedAmount, 
        bank_safe_id, 
        reason, 
        journal_entry_id: jeId, 
        created_by: userId 
      })
      .select('*')
      .single();

    if (vdErr) {
      console.error('Voucher disbursement insert error:', vdErr);
      throw vdErr;
    }

    // إذا كان هناك فواتير، تحديثها
    if (disbursement_type === 'supplier' && invoice_items && invoice_items.length > 0) {
      for (const item of invoice_items) {
        await s.from('disbursement_invoice_items')
          .insert({ 
            company_id: companyId,
            disbursement_voucher_id: vd.id, 
            purchase_invoice_id: item.purchase_invoice_id, 
            amount: item.amount 
          });
      }
    }

    // إرسال إشعار تيليجرام للمعاملات الكبيرة
    try {
      const { data: bankInfo } = await s.from('banks_safes')
        .select('name')
        .eq('id', bank_safe_id)
        .maybeSingle();
      
      const { data: userInfo } = await s.from('users')
        .select('name')
        .eq('id', userId)
        .maybeSingle();

      const bypassTelegram = await canBypassTelegramConfirmation(userId, companyId);
      
      if (!bypassTelegram) {
        const notifResult = await sendTransactionNotification(companyId, 'disbursement', {
          amount: parsedAmount,
          reason,
          bankName: bankInfo?.name,
          userName: userInfo?.name,
          date,
        });
        
        if (notifResult.notified) {
          return success({ ...vd, telegram_notified: true }, 201);
        }
      }
    } catch (notifErr) {
      console.warn('Telegram notification failed:', notifErr);
    }

    return success(vd, 201);
  } catch (err) {
    console.error('Disbursement POST error:', err);
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireManagerOrAbove(request);
    const s = sb();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return error('id is required');

    const { data: vd } = await s.from('voucher_disbursements')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!vd) return error('سند الصرف غير موجود');

    if (vd.journal_entry_id) {
      await s.from('journal_lines').delete().eq('journal_entry_id', vd.journal_entry_id);
      await s.from('journal_entries').delete().eq('id', vd.journal_entry_id);
    }

    if (vd.employee_id && vd.disbursement_type === 'employee_advance') {
      const { data: adv } = await s.from('employee_advances')
        .select('id')
        .eq('employee_id', vd.employee_id)
        .eq('amount', vd.amount)
        .eq('type', 'advance')
        .limit(1)
        .maybeSingle();

      if (adv) {
        await s.from('employee_advances').delete().eq('id', adv.id);
      }
    }

    await s.from('voucher_disbursements').delete().eq('id', id);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
