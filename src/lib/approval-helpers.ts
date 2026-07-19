/**
 * دوال مساعدة لنظام الاعتماد
 * تستخدم في APIs إنشاء المعاملات
 */

import { getSupabase } from '@/lib/supabase-client';
import { requireApproval } from '@/lib/notifications';

const sb = () => getSupabase();

/**
 * فحص ما إذا كانت المعاملة تحتاج لاعتماد قبل الحفظ
 * 
 * الاستخدام:
 * ```typescript
 * const approvalCheck = await checkTransactionBeforeSave(
 *   auth.companyId,
 *   auth.userId,
 *   amount,
 *   'voucher_disbursement',
 *   transactionId
 * );
 * 
 * if (approvalCheck.blocked) {
 *   return error(approvalCheck.message || 'تتطلب العملية اعتماداً');
 * }
 * ```
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
 * إنشاء قيد محاسبي لمعاملة معتمدة
 * هذه الدالة تستدعى تلقائياً عند الموافقة عبر التيليغرام
 */
export async function createJournalEntryForApprovedTransaction(
  companyId: string,
  userId: string,
  transactionType: string,
  transactionId: string
): Promise<void> {
  const s = sb();
  
  // الحصول على تفاصيل المعاملة الأصلية
  let transactionData: any = null;
  
  switch (transactionType) {
    case 'voucher_disbursement': {
      const { data } = await s.from('voucher_disbursements')
        .select('*')
        .eq('id', transactionId)
        .eq('company_id', companyId)
        .single();
      transactionData = data;
      break;
    }
    case 'voucher_receipt': {
      const { data } = await s.from('voucher_receipts')
        .select('*')
        .eq('id', transactionId)
        .eq('company_id', companyId)
        .single();
      transactionData = data;
      break;
    }
    case 'cash_transaction': {
      const { data } = await s.from('cash_transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('company_id', companyId)
        .single();
      transactionData = data;
      break;
    }
  }
  
  if (!transactionData) {
    console.error(`Transaction not found: ${transactionType}:${transactionId}`);
    return;
  }
  
  // إنشاء القيد المحاسبي المناسب
  // (هذه الدالة يجب أن تنفذ بناءً على منطق المشروع)
  // هنا مجرد مثال
  
  console.log(`Creating journal entry for approved ${transactionType}:${transactionId}`);
  // TODO: تنفيذ إنشاء القيد المحاسبي
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
  
  return { status: 'approved' }; // الوضع الافتراضي
}