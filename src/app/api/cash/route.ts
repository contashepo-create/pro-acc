import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, requireModulePermission, handleApiError, getPaginationParams, getDateRangeParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';
import { checkBankBalance } from '@/lib/notifications';

const sb = () => getSupabase();

/**
 * GET /api/cash
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'cash', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('account_id');
    const contactId = url.searchParams.get('contact_id');
    const employeeId = url.searchParams.get('employee_id');
    const bankSafeId = url.searchParams.get('bank_safe_id');

    let query = s.from('cash_transactions')
      .select(`
        *,
        accounts(name),
        categories(name),
        bank_safes(name),
        contacts(name),
        employees(name)
      `, { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (type) query = query.eq('type', type);
    if (accountId) query = query.eq('account_id', accountId);
    if (contactId) query = query.eq('contact_id', contactId);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (bankSafeId) query = query.eq('bank_safe_id', bankSafeId);

    const offset = (page - 1) * pageSize;
    const result = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (result.error) {
      console.error('Cash fetch error:', result.error);
      throw result.error;
    }

    return success({
      transactions: result.data || [],
      total: result.count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((result.count || 0) / pageSize),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/cash
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    const {
      date,
      type,
      amount,
      accountId,
      categoryId,
      bankSafeId,
      contactId,
      employeeId,
      projectId,
      reason,
      description,
      referenceType,
      referenceId,
      receiptId,
      disbursementId,
    } = body;

    if (!date || !type || !amount || !reason) {
      return error('التاريخ، النوع، المبلغ، والسبب مطلوبة', 400);
    }

    if (parseFloat(amount) <= 0) {
      return error('المبلغ يجب أن يكون أكبر من صفر', 400);
    }

    // Get account info if specified
    let accountInfo = null;
    if (accountId) {
      const { data } = await s.from('accounts')
        .select('id, name, type, name_en, current_balance')
        .eq('id', accountId)
        .single();
      accountInfo = data;
    }

    // Get bank safe info if specified
    let bankSafeInfo = null;
    if (bankSafeId) {
      const { data } = await s.from('banks_safes')
        .select('id, name, type, account_id')
        .eq('id', bankSafeId)
        .single();
      bankSafeInfo = data;
    }

    // Check bank balance if bank safe provided
    if (bankSafeInfo && bankSafeInfo.account_id) {
      const balance = await checkBankBalance(
        bankSafeInfo.id,
        parseFloat(amount),
        auth.companyId
      );
      if (!balance.allowed) {
        return error(balance.message || 'الرصيد غير كافٍ للصرف هذا المبلغ', 400);
      }
    }

    // Determine credit account based on transaction type
    let creditAccountCode: string | null = null;
    if (type === 'revenue') {
      creditAccountCode = ACCOUNT_CODES.CONTRACT_REVENUE;
    } else if (type === 'expense') {
      creditAccountCode = ACCOUNT_CODES.DIRECT_COSTS;
    } else if (bankSafeInfo?.account_id) {
      creditAccountCode = null; // use bank account itself
    }

    // Resolve account IDs
    const { data: creditAcc } = creditAccountCode
      ? await s.from('accounts').select('id').eq('code', creditAccountCode).eq('company_id', auth.companyId).maybeSingle()
      : { data: null };

    const debitAccountId = bankSafeInfo?.account_id || accountId || null;
    const creditAccountId = (creditAcc as any)?.id || bankSafeInfo?.account_id || null;

    // Insert cash transaction record
    const { data: transaction, error: insertErr } = await s.from('cash_transactions')
      .insert({
        company_id: auth.companyId,
        date,
        type,
        amount: parseFloat(amount),
        account_id: debitAccountId || null,
        bank_safe_id: bankSafeId || null,
        contact_id: contactId || null,
        employee_id: employeeId || null,
        project_id: projectId || null,
        category_id: categoryId || null,
        reason,
        description: description || null,
        reference_type: referenceType || null,
        reference_id: referenceId || null,
        receipt_id: receiptId || null,
        disbursement_id: disbursementId || null,
        created_by: auth.userId,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Create journal entry via helper
    if (debitAccountId && creditAccountId) {
      const je = await createJournalEntry(auth.companyId, {
        date,
        type: 'general',
        description: description || reason,
        lines: [
          {
            account_id: debitAccountId,
            debit: parseFloat(amount),
            credit: 0,
            description: description || reason,
            project_id: projectId || null,
            contact_id: contactId || null,
          },
          {
            account_id: creditAccountId,
            debit: 0,
            credit: parseFloat(amount),
            description: description || reason,
            project_id: projectId || null,
            contact_id: contactId || null,
          },
        ],
        reference_type: referenceType || 'cash_transaction',
        reference_id: referenceId || (transaction as any).id,
        created_by: auth.userId,
      });

      if (je.error) {
        console.warn('Failed to create journal entry for cash transaction:', je.error);
      }
    }

    return success(transaction, 201);
  } catch (err) {
    return handleApiError(err);
  }
}