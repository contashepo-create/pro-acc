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
    const bankSafeId = url.searchParams.get('bank_safe_id');

    let query = s.from('cash_transactions')
      .select(`
        *,
        accounts(name),
        transaction_categories(name),
        bank_safes(name),
        contacts(name)
      `, { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (type) query = query.eq('type', type);
    if (accountId) query = query.eq('account_id', accountId);
    if (contactId) query = query.eq('contact_id', contactId);
    if (bankSafeId) query = query.eq('bank_safe_id', bankSafeId);

    const offset = (page - 1) * pageSize;
    const result = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (result.error) {
      console.error('Cash fetch error:', result.error);
      return success({ transactions: [], total: 0, page, pageSize, totalPages: 0 });
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
      projectId,
      reason,
      description,
      tax_rate,
      tax_enabled,
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

    // VAT calculation
    const vRate = (tax_enabled && tax_rate) ? tax_rate : 0;
    const baseAmount = parseFloat(amount);
    const taxAmount = type === 'revenue' ? baseAmount * vRate / (1 + vRate) : 0;
    // For revenue: amount includes VAT, so net = amount / (1+rate), VAT = amount - net
    // For expense: amount is the expense, VAT is extra
    const expenseTaxAmount = type === 'expense' ? baseAmount * vRate : 0;
    const totalPayment = type === 'expense' ? baseAmount + expenseTaxAmount : baseAmount;

    // Insert cash transaction record
    const { data: transaction, error: insertErr } = await s.from('cash_transactions')
      .insert({
        company_id: auth.companyId,
        date,
        type,
        amount: baseAmount,
        account_id: debitAccountId || null,
        bank_safe_id: bankSafeId || null,
        contact_id: contactId || null,
        project_id: projectId || null,
        category_id: categoryId || null,
        reason,
        created_by: auth.userId,
        tax_rate: vRate,
        tax_amount: taxAmount || expenseTaxAmount,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Create journal entry via helper with VAT support
    if (debitAccountId && creditAccountId) {
      const journalLines: any[] = [];

      if (type === 'revenue') {
        // Revenue: debit cash (full), credit revenue (net), credit VAT_SALES (vat)
        const netRevenue = baseAmount - taxAmount;
        journalLines.push({
          account_id: debitAccountId,
          debit: baseAmount,
          credit: 0,
          description: description || reason,
          project_id: projectId || null,
          contact_id: contactId || null,
        });
        journalLines.push({
          account_id: creditAccountId,
          debit: 0,
          credit: netRevenue,
          description: description || reason,
          project_id: projectId || null,
          contact_id: contactId || null,
        });
        if (taxAmount > 0) {
          const { data: vatSalesAcc } = await s.from('accounts').select('id').eq('code', ACCOUNT_CODES.VAT_SALES).eq('company_id', auth.companyId).maybeSingle();
          if (vatSalesAcc) {
            journalLines.push({
              account_id: (vatSalesAcc as any).id,
              debit: 0,
              credit: taxAmount,
              description: `ضريبة مخرجات: ${description || reason}`,
              project_id: projectId || null,
              contact_id: contactId || null,
            });
          }
        }
      } else {
        // Expense: debit expense (net), debit VAT_PURCHASES (vat), credit cash (total)
        journalLines.push({
          account_id: creditAccountId,
          debit: baseAmount,
          credit: 0,
          description: description || reason,
          project_id: projectId || null,
          contact_id: contactId || null,
        });
        journalLines.push({
          account_id: debitAccountId,
          debit: 0,
          credit: totalPayment,
          description: description || reason,
          project_id: projectId || null,
          contact_id: contactId || null,
        });
        if (expenseTaxAmount > 0) {
          const { data: vatPurchAcc } = await s.from('accounts').select('id').eq('code', ACCOUNT_CODES.VAT_PURCHASES).eq('company_id', auth.companyId).maybeSingle();
          if (vatPurchAcc) {
            journalLines.push({
              account_id: (vatPurchAcc as any).id,
              debit: expenseTaxAmount,
              credit: 0,
              description: `ضريبة مدخلات: ${description || reason}`,
              project_id: projectId || null,
              contact_id: contactId || null,
            });
          }
        }
      }

      const je = await createJournalEntry(auth.companyId, {
        date,
        type: 'general',
        description: description || reason,
        lines: journalLines,
        reference_type: 'cash_transaction',
        reference_id: (transaction as any).id,
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