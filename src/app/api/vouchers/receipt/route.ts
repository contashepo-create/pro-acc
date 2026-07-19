import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, requireModulePermission, handleApiError, requireManagerOrAbove } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { getNextJournalNumber, getNextVoucherNumber } from '@/lib/numbering';
import { checkApprovalThreshold, sendTransactionNotification } from '@/lib/notifications';
import { insertJournalLines } from '@/lib/journal-utils';
import { canBypassTelegramConfirmation } from '@/lib/permissions';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'receipts', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const receiptType = url.searchParams.get('receiptType');

    let data, count, queryError;
    try {
      let query = s.from('voucher_receipts')
        .select('*, contacts(name), banks_safes(name), journal_entries(number)', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (receiptType) query = query.eq('receipt_type', receiptType);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      count = result.count;
      queryError = result.error;
    } catch (joinErr) {
      console.warn('Receipt GET with joins failed, fallback:', joinErr);
      let query = s.from('voucher_receipts')
        .select('*', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (receiptType) query = query.eq('receipt_type', receiptType);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      count = result.count;
      queryError = result.error;
    }

    if (queryError) throw queryError;

    const receipts = (data || []).map((vr: any) => ({
      ...vr, contact_name: vr.contacts?.name || null, bank_name: vr.banks_safes?.name || null,
      journal_entry_number: vr.journal_entries?.number || null,
    }));

    return success({ receipts, total: count || 0, page, pageSize });
  } catch (err) {
    console.error('Receipt GET error:', err);
    return success({ receipts: [], total: 0, page: 1, pageSize: 50 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'receipts', 'create');
    const s = sb();
    const data = await parseBody(request);
    const { date, receipt_type, contact_id, amount, bank_safe_id, reason, reference_type, reference_id, invoice_items, account_id } = data;

    if (!date || !receipt_type || !amount || !bank_safe_id || !reason)
      return error('التاريخ ونوع السند والمبلغ والبنك/الخزينة والبيان مطلوب');

    const companyId = auth.companyId;
    const userId = auth.userId;

    // ✅ التحقق من حد الموافقة وإرسال تنبيه إذا لزم الأمر
    const approvalCheck = await checkApprovalThreshold(companyId, amount, 'voucher_receipt', userId);
    if (approvalCheck.requiresApproval) {
      console.log(`Approval required for receipt: ${amount} (threshold exceeded)`);
    }

    // الحصول على رقم السند
    const nextNum = await getNextVoucherNumber(companyId, 'voucher_receipts');

    // الحصول على حساب البنك/الخزينة
    const { data: bankAccount } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', bank_safe_id)
      .maybeSingle();

    if (!bankAccount?.account_id) {
      return error('الحساب البنكي غير موجود لهذا البنك/الخزينة. يرجى ربط البنك بحساب محاسبي');
    }

    // إنشاء القيد المحاسبي
    const jeNum = await getNextJournalNumber(companyId, date);
    const { data: je, error: jeErr } = await s.from('journal_entries')
      .insert({ 
        company_id: companyId, 
        number: jeNum, 
        date, 
        type: 'general', 
        description: `سند قبض: ${reason}`, 
        created_by: userId 
      })
      .select('id')
      .single();

    if (jeErr) {
      console.error('Journal entry creation error:', jeErr);
      throw jeErr;
    }
    const jeId = je.id;

    // تحديد الحساب المقابل بناءً على نوع السند
    let counterpartAccountId: string | null = null;
    
    if (receipt_type === 'client' && contact_id) {
      const { data: arAccount } = await s.from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', ACCOUNT_CODES.ACCOUNTS_RECEIVABLE)
        .maybeSingle();
      counterpartAccountId = arAccount?.id || null;
    } else if (receipt_type === 'supplier_refund') {
      const { data: apAccount } = await s.from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE)
        .maybeSingle();
      counterpartAccountId = apAccount?.id || null;
    } else if (account_id) {
      counterpartAccountId = account_id;
    }

    // إنشاء سطور القيد باستخدام الدالة المساعدة (تضمن إضافة جميع الحقول المطلوبة)
    const linesInput: any[] = [];
    
    // مدين: البنك/الخزينة
    linesInput.push({ 
      journal_entry_id: jeId, 
      account_id: bankAccount.account_id, 
      debit: amount, 
      credit: 0 
    });

    // دائن: الحساب المقابل
    if (counterpartAccountId) {
      linesInput.push({ 
        journal_entry_id: jeId, 
        account_id: counterpartAccountId, 
        debit: 0, 
        credit: amount 
      });
    }

    const { error: jlErr } = await insertJournalLines(companyId, linesInput);
    if (jlErr) {
      console.error('Journal lines insert error:', jlErr);
      throw jlErr;
    }

    // حفظ السند
    const { data: vr, error: vrErr } = await s.from('voucher_receipts')
      .insert({ 
        company_id: companyId, 
        number: nextNum, 
        date, 
        receipt_type, 
        contact_id: contact_id || null, 
        amount, 
        bank_safe_id, 
        reason, 
        reference_type: reference_type || null, 
        reference_id: reference_id || null, 
        journal_entry_id: jeId, 
        created_by: userId 
      })
      .select('*')
      .single();

    if (vrErr) {
      console.error('Voucher receipt insert error:', vrErr);
      throw vrErr;
    }

    // إذا كان هناك فواتير، تحديثها
    if (receipt_type === 'client' && invoice_items && invoice_items.length > 0) {
      for (const item of invoice_items) {
        const { data: inv } = await s.from('invoices')
          .select('id, total, number')
          .eq('id', item.invoice_id)
          .maybeSingle();

        if (inv) {
          const { data: paidItems } = await s.from('receipt_invoice_items')
            .select('amount')
            .eq('invoice_id', item.invoice_id);

          const paidSoFar = (paidItems || []).reduce((sum: number, r: any) => sum + (parseFloat(r.amount) || 0), 0);
          const newPaid = paidSoFar + parseFloat(item.amount);
          const total = parseFloat(inv.total);
          const newStatus = newPaid >= total ? 'paid' : 'partial';

          await s.from('invoices')
            .update({ paid_amount: newPaid, status: newStatus })
            .eq('id', item.invoice_id);

          await s.from('receipt_invoice_items')
            .insert({ 
              company_id: companyId,
              voucher_receipt_id: vr.id, 
              invoice_id: item.invoice_id, 
              amount: item.amount 
            });
        }
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
        const notifResult = await sendTransactionNotification(companyId, 'receipt', {
          amount: parseFloat(amount),
          reason,
          bankName: bankInfo?.name,
          userName: userInfo?.name,
          date,
        });
        
        // إضافة معلومات الإشعار للرد
        if (notifResult.notified) {
          return success({ ...vr, telegram_notified: true }, 201);
        }
      }
    } catch (notifErr) {
      console.warn('Telegram notification failed:', notifErr);
      // لا نوقف العملية إذا فشل الإشعار
    }

    return success(vr, 201);
  } catch (err) {
    console.error('Receipt POST error:', err);
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

    const { data: vr } = await s.from('voucher_receipts')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!vr) return error('سند القبض غير موجود');

    const { data: deps } = await s.from('receipt_invoice_items')
      .select('id')
      .eq('voucher_receipt_id', id)
      .limit(1);

    if (deps && deps.length > 0) return error('لا يمكن حذف سند قبض مرتبط بفواتير');

    if (vr.journal_entry_id) {
      await s.from('journal_lines').delete().eq('journal_entry_id', vr.journal_entry_id);
      await s.from('journal_entries').delete().eq('id', vr.journal_entry_id);
    }

    await s.from('voucher_receipts').delete().eq('id', id);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
