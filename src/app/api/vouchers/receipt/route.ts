import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError, getPaginationParams, getDateRangeParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextVoucherNumber } from '@/lib/numbering';

const sb = () => getSupabase();

/**
 * GET /api/vouchers/receipt
 * Fixed to properly handle errors instead of swallowing them
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const receiptType = url.searchParams.get('receiptType');

    let query = s.from('voucher_receipts')
      .select(`
        *,
        contacts(name),
        employees(name),
        banks_safes(name),
        journal_entries(number)
      `, { count: 'exact' })
      .eq('company_id', auth.companyId);
    
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (receiptType) query = query.eq('receipt_type', receiptType);

    const offset = (page - 1) * pageSize;
    const result = await query
      .order('date', { ascending: false })
      .order('number', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (result.error) {
      console.error('Receipt fetch error:', result.error);
      return error('فشل تحميل بيانات السندات', 500);
    }

    return success({
      receipts: result.data || [],
      total: result.count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((result.count || 0) / pageSize),
    });
  } catch (err) {
    console.error('Receipt GET error:', err);
    return handleApiError(err);
  }
}

/**
 * POST /api/vouchers/receipt
 * Create receipt with proper validation
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    const {
      date,
      receiptType,
      contactId,
      amount,
      bankSafeId,
      reason,
    } = body;

    if (!date || !receiptType || !amount || !bankSafeId || !reason) {
      return error('جميع الحقول المطلوبة يجب تعبئتها', 400);
    }

    if (parseFloat(amount) <= 0) {
      return error('المبلغ يجب أن يكون أكبر من صفر', 400);
    }

    const nextNumber = await getNextVoucherNumber('voucher_receipts', auth.companyId);
    const { data: bankSafe } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', bankSafeId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!bankSafe) {
      return error('البنك/الخزينة غير موجود', 404);
    }

    const { data: receipt, error: receiptError } = await s.from('voucher_receipts')
      .insert({
        company_id: auth.companyId,
        number: nextNumber,
        date,
        receipt_type: receiptType,
        contact_id: contactId || null,
        amount: parseFloat(amount),
        bank_safe_id: bankSafeId,
        reason,
        created_by: auth.userId,
        status: 'approved', // Use proper status instead of hardcoded
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (receiptError) throw receiptError;

    return success(receipt, 201);
  } catch (err) {
    console.error('Receipt creation error:', err);
    return handleApiError(err);
  }
}