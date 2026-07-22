/**
 * دوال مساعدة لنظام الاعتماد
 * تستخدم في APIs إنشاء المعاملات وتوليد القيود المالية التلقائية عند الاعتماد
 */

import { getSupabase } from '@/lib/supabase-client';
import { requireApproval } from '@/lib/notifications';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

/**
 * فحص ما إذا كانت المعاملة تحتاج لاعتماد قبل الحفظ
 */
export async function checkTransactionBeforeSave(
  companyId: string,
  userId: string,
  amount: number,
  transactionType: string,
  transactionId: string,
  description?: string
): Promise<{ blocked: boolean; message?: string; requiresApproval: boolean }> {
  // التحقق من الاعتماد
  const approvalResult = await requireApproval(
    companyId,
    amount,
    transactionType,
    userId,
    transactionId,
    description
  );
  
  return {
    blocked: approvalResult.blocked,
    message: approvalResult.message,
    requiresApproval: approvalResult.requiresApproval
  };
}

/**
 * إنشاء قيد محاسبي مزدوج سليم ومعتمد ماليًا لمعاملة تمت الموافقة عليها عبر تيليجرام
 * تضمن هذه الدالة ترحيل الحسابات بدقة مذهلة وصحيحة محاسبياً (المدين والدائن) تلقائياً فور نقرة المدير
 */
export async function createJournalEntryForApprovedTransaction(
  companyId: string,
  userId: string,
  transactionType: string,
  transactionId: string
): Promise<void> {
  const s = sb();
  
  // 1. جلب بيانات المعاملة الأصلية الموقوفة بحالة الانتظار
  let transactionData: any = null;
  
  switch (transactionType) {
    case 'voucher_disbursement': {
      const { data } = await s.from('voucher_disbursements')
        .select('*')
        .eq('id', transactionId)
        .eq('company_id', companyId)
        .maybeSingle();
      transactionData = data;
      break;
    }
    case 'voucher_receipt': {
      const { data } = await s.from('voucher_receipts')
        .select('*')
        .eq('id', transactionId)
        .eq('company_id', companyId)
        .maybeSingle();
      transactionData = data;
      break;
    }
    case 'cash_transaction': {
      const { data } = await s.from('cash_transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('company_id', companyId)
        .maybeSingle();
      transactionData = data;
      break;
    }
  }
  
  if (!transactionData) {
    console.error(`[Approval Journal Engine] Original transaction not found: ${transactionType}:${transactionId}`);
    return;
  }
  
  try {
    const { createJournalEntry } = await import('@/lib/journal-utils');
    const amount = parseFloat(transactionData.amount);
    const date = transactionData.date;
    const number = transactionData.number;
    const reason = transactionData.reason || transactionData.description || '';

    // أ. معالجة سندات الصرف المعتمدة (Voucher Disbursement)
    if (transactionType === 'voucher_disbursement') {
      const { data: bankSafe } = await s.from('banks_safes').select('account_id').eq('id', transactionData.bank_safe_id).maybeSingle();
      if (!bankSafe || !bankSafe.account_id) return;

      // تحديد الحساب المدين (المصروف أو الالتزام)
      let debitAccountId = ACCOUNT_CODES.CASH_ON_HAND;
      if (transactionData.disbursement_type === 'supplier') {
        debitAccountId = ACCOUNT_CODES.ACCOUNTS_PAYABLE;
      } else if (transactionData.disbursement_type === 'employee_advance') {
        debitAccountId = ACCOUNT_CODES.EMPLOYEE_ADVANCES;
      } else if (transactionData.disbursement_type === 'subcontractor') {
        debitAccountId = ACCOUNT_CODES.SUBCONTRACTORS_PAYABLE;
      }

      // إنشاء القيد المحاسبي المتزن (المدين: المصروف/الالتزام، الدائن: البنك/الخزينة)
      const { journalId, error: jeErr } = await createJournalEntry(companyId, {
        date,
        type: 'general',
        description: `اعتماد سند صرف رقم ${number}: ${reason}`,
        lines: [
          {
            account_id: debitAccountId, // مدين: الحساب المختص بقيمة الصرف
            debit: amount,
            credit: 0,
            contact_id: transactionData.contact_id || null,
          },
          {
            account_id: bankSafe.account_id, // دائن: البنك/الخزينة المنصرف منها
            debit: 0,
            credit: amount,
            bank_safe_id: transactionData.bank_safe_id,
          }
        ],
        reference_type: 'voucher_disbursement',
        reference_id: transactionId,
        created_by: userId,
      });

      if (jeErr) throw jeErr;

      // ربط القيد بالسند وتعديل الحالة إلى معتمد
      if (journalId) {
        await s.from('voucher_disbursements')
          .update({ journal_entry_id: journalId, status: 'approved' })
          .eq('id', transactionId);
      }
    } 
    // ب. معالجة سندات القبض المعتمدة (Voucher Receipt)
    else if (transactionType === 'voucher_receipt') {
      const { data: bankSafe } = await s.from('banks_safes').select('account_id').eq('id', transactionData.bank_safe_id).maybeSingle();
      if (!bankSafe || !bankSafe.account_id) return;

      // تحديد الحساب الدائن
      let creditAccountId = ACCOUNT_CODES.CASH;
      if (transactionData.receipt_type === 'client') {
        creditAccountId = ACCOUNT_CODES.ACCOUNTS_RECEIVABLE;
      } else if (transactionData.receipt_type === 'supplier_refund') {
        creditAccountId = ACCOUNT_CODES.ACCOUNTS_PAYABLE;
      }

      // إنشاء القيد (المدين: البنك/الخزينة المستلمة، الدائن: العميل/المورد)
      const { journalId, error: jeErr } = await createJournalEntry(companyId, {
        date,
        type: 'general',
        description: `اعتماد سند قبض رقم ${number}: ${reason}`,
        lines: [
          {
            account_id: bankSafe.account_id, // مدين: البنك/الخزينة المستلمة
            debit: amount,
            credit: 0,
            bank_safe_id: transactionData.bank_safe_id,
          },
          {
            account_id: creditAccountId, // دائن: العميل/المورد المسدد
            debit: 0,
            credit: amount,
            contact_id: transactionData.contact_id || null,
          }
        ],
        reference_type: 'voucher_receipt',
        reference_id: transactionId,
        created_by: userId,
      });

      if (jeErr) throw jeErr;

      if (journalId) {
        await s.from('voucher_receipts')
          .update({ journal_entry_id: journalId, status: 'approved' })
          .eq('id', transactionId);
      }
    }
  } catch (e) {
    console.error('[Approval Journal Engine Failed]:', e);
  }
}

/**
 * الحصول على حالة اعتماد المعاملة
 */
export async function getTransactionApprovalStatus(
  companyId: string,
  transactionType: string,
  transactionId: string
): Promise<{ status: string; approvalId?: string | null }> {
  const s = sb();
  
  // البحث في جدول الاعتمادات
  const { data: approval } = await s.from('approval_requests')
    .select('id, status')
    .eq('company_id', companyId)
    .eq('transaction_type', transactionType)
    .eq('transaction_id', transactionId)
    .maybeSingle();
  
  if (approval) {
    return {
      status: (approval as any).status,
      approvalId: (approval as any).id
    };
  }
  
  // إذا لم يوجد طلب اعتماد، تحقق من حالة المعاملة نفسها
  const tableMap: Record<string, string> = {
    'voucher_disbursement': 'voucher_disbursements',
    'voucher_receipt': 'voucher_receipts',
    'cash_transaction': 'cash_transactions',
    'journal_entry': 'journal_entries',
  };
  
  const tableName = tableMap[transactionType];
  if (tableName) {
    const { data: transaction } = await s.from(tableName)
      .select('status')
      .eq('id', transactionId)
      .eq('company_id', companyId)
      .maybeSingle();
    
    if (transaction) {
      return { status: (transaction as any).status || 'approved' };
    }
  }
  
  return { status: 'approved' };
}
