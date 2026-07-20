/**
 * دالة آمنة للحصول على الرقم التالي مع منع تضارب الترقيم
 * تستخدم Sequence PostgreSQL في الحالات المدعومة، أو قفل مبني على SELECT FOR UPDATE
 */

import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * الحصول على الرقم التالي باستخدام PostgreSQL Sequence (آمن للتزامن)
 */
export async function getNextNumberSequence(
  sequenceName: string,
  companyId: string
): Promise<number> {
  const s = sb();
  
  // محاولة استخدام PostgreSQL Sequence أولاً
  try {
    const { data } = await s.rpc('get_next_number_sequence', {
      p_sequence_name: sequenceName,
      p_company_id: companyId,
    });
    
    if (data !== null) {
      return Number(data);
    }
  } catch (err) {
    console.warn(`Failed to use sequence ${sequenceName}, falling back to lock-based approach:`, err);
  }
  
  // Fallback: استخدام SELECT FOR UPDATE لمنع تضارب الترقيم
  const client = await getSupabase();
  
  try {
    // استخدام transaction for advisory lock
    const { data: lockResult } = await client.rpc('pg_advisory_lock', {
      lock_id: `${sequenceName}_${companyId}`.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 2147483647,
    });
    
    // Get current number with lock
    const { data: currentSeq } = await s
      .from(sequenceName)
      .select('last_number')
      .eq('company_id', companyId)
      .single();
    
    const nextNumber = (currentSeq?.last_number || 0) + 1;
    
    // Update with lock
    await s
      .from(sequenceName)
      .update({ last_number: nextNumber, updated_at: new Date().toISOString() })
      .eq('company_id', companyId);
    
    // Release lock
    await client.rpc('pg_advisory_unlock', {
      lock_id: `${sequenceName}_${companyId}`.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 2147483647,
    });
    
    return nextNumber;
  } catch (err) {
    console.error(`Failed to get next number for ${sequenceName}:`, err);
    throw new Error(`فشل الحصول على الرقم التالي: ${sequenceName}`);
  }
}

/**
 * دالة آمنة للحصول على رقم الفاتورة التالية
 */
export async function getNextInvoiceNumber(companyId: string): Promise<number> {
  return getNextNumberSequence('invoice_sequences', companyId);
}

/**
 * دالة آمنة للحصول على رقم القيد اليومي التالي
 */
export async function getNextJournalNumber(companyId: string): Promise<number> {
  return getNextNumberSequence('journal_sequences', companyId);
}

/**
 * دالة آمنة للحصول على رقم السند التالي
 */
export async function getNextVoucherNumber(
  voucherType: 'voucher_receipts' | 'voucher_disbursements',
  companyId: string
): Promise<number> {
  const sequenceName = `voucher_${voucherType}_sequences`;
  return getNextNumberSequence(sequenceName, companyId);
}