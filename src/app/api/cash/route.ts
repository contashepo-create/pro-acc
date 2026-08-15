import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError, getPaginationParams, getDateRangeParams, parseBody } from '@/lib/api-helpers';
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
        banks_safes(name),
        contacts(name)
      `, { count: 'exact' })
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled');

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
      return success({ transactions: [], rows: [], total: 0, page, pageSize, totalPages: 0 });
    }

    const transactions = (result.data || []).map((t: any) => ({
      ...t,
      account_name: t.accounts?.name || t.account_name || null,
      bank_name: t.banks_safes?.name || t.bank_name || null,
      contact_name: t.contacts?.name || t.contact_name || null,
    }));

    return success({
      transactions,
      rows: transactions,
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
    const auth = await requireModulePermission(request, 'cash', 'create');
    const s = sb();
    const body = await parseBody<Record<string, unknown>>(request);

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
    } = body as Record<string, any>;

    const normalizedType = type === 'receipt' ? 'revenue' : type;
    if (!date || !normalizedType || !amount || !reason) {
      return error('التاريخ، النوع، المبلغ، والسبب مطلوبة', 400);
    }

    if (normalizedType !== 'revenue' && normalizedType !== 'expense') {
      return error('نوع الحركة يجب أن يكون قبض أو صرف', 400);
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) > 1e-8) {
      return error('المبلغ يجب أن يكون أكبر من صفر وبمنزلتين عشريتين كحد أقصى', 400);
    }
    if (!bankSafeId) {
      return error('الخزينة أو البنك مطلوب للحركة النقدية', 400);
    }

    const txnType = normalizedType;

    // Get account info if specified — عزل مستأجرين صارم
    let accountInfo: any = null;
    if (accountId) {
      const { data } = await s.from('accounts')
        .select('id, name, type, name_en, current_balance')
        .eq('id', accountId)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (!data) return error('الحساب المحدد غير موجود', 404);
      accountInfo = data;
    }

    // Get bank safe info if specified — عزل مستأجرين صارم
    let bankSafeInfo: any = null;
    if (bankSafeId) {
      const { data } = await s.from('banks_safes')
        .select('id, name, type, account_id')
        .eq('id', bankSafeId)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (!data) return error('الخزينة/البنك المحدد غير موجود', 404);
      bankSafeInfo = data;
    }

    if (!bankSafeInfo?.account_id) {
      return error('الخزينة/البنك غير مرتبط بحساب أستاذ صالح', 400);
    }
    // Only expenses consume cash. Applying this check to revenue rejects a
    // legitimate receipt when the cash account starts with a zero balance.
    if (txnType === 'expense') {
      const balance = await checkBankBalance(bankSafeInfo.id, parsedAmount, auth.companyId);
      if (!balance.allowed) return error(balance.message || 'الرصيد غير كافٍ للصرف هذا المبلغ', 400);
    }

    if (contactId) {
      const { data: contact } = await s.from('contacts').select('id')
        .eq('id', contactId).eq('company_id', auth.companyId).maybeSingle();
      if (!contact) return error('الطرف المحدد غير موجود', 404);
    }
    if (projectId) {
      const { data: project } = await s.from('projects').select('id')
        .eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
      if (!project) return error('المشروع المحدد غير موجود', 404);
    }

    // Determine counterpart account based on transaction type
    const vRate = (tax_enabled && tax_rate !== undefined) ? Number(tax_rate) : 0;
    if (!Number.isFinite(vRate) || vRate < 0 || vRate > 1 || Math.abs(vRate * 10000 - Math.round(vRate * 10000)) > 1e-8) {
      return error('نسبة الضريبة غير صالحة', 400);
    }
    const baseAmount = parsedAmount;
    const taxAmount = txnType === 'revenue' ? baseAmount * vRate / (1 + vRate) : 0;
    const expenseTaxAmount = txnType === 'expense' ? baseAmount * vRate : 0;
    const totalPayment = txnType === 'expense' ? baseAmount + expenseTaxAmount : baseAmount;

    // النقدية (الطرف النقدي) — الخزينة/البنك إن وُجد وإلا الحساب المحدد
    const cashAccountId = bankSafeInfo?.account_id || accountId || null;

    // الحساب المقابل (إيراد/مصروف) — حساب مختار من الواجهة أو حساب تحكم
    let counterpartAccountId: string | null = accountId || null;
    if (txnType === 'revenue' && !accountId) {
      const { data: revAcc } = await s.from('accounts').select('id').eq('code', ACCOUNT_CODES.CONTRACT_REVENUE).eq('company_id', auth.companyId).maybeSingle();
      counterpartAccountId = revAcc?.id || null;
    } else if (txnType === 'expense' && !accountId) {
      const { data: expAcc } = await s.from('accounts').select('id').eq('code', ACCOUNT_CODES.DIRECT_COSTS).eq('company_id', auth.companyId).maybeSingle();
      counterpartAccountId = expAcc?.id || null;
    }

    if (!cashAccountId || !counterpartAccountId) {
      return error('الحسابات المحاسبية للحركة غير مكتملة (النقدية أو الحساب المقابل) — راجع شجرة الحسابات', 400);
    }
    if (cashAccountId === counterpartAccountId) {
      return error('لا يمكن أن يكون حساب النقدية هو الحساب المقابل للحركة', 400);
    }

    // حسابات الضريبة إلزامية عند احتسابها — وإلا قيد غير متوازن
    let vatSalesAccId: string | null = null;
    let vatPurchAccId: string | null = null;
    if (taxAmount > 0) {
      const { data: vatSalesAcc } = await s.from('accounts').select('id').eq('code', ACCOUNT_CODES.VAT_SALES).eq('company_id', auth.companyId).maybeSingle();
      if (!vatSalesAcc) return error('حساب ضريبة المبيعات (2120) غير موجود');
      vatSalesAccId = vatSalesAcc.id;
    }
    if (expenseTaxAmount > 0) {
      const { data: vatPurchAcc } = await s.from('accounts').select('id').eq('code', ACCOUNT_CODES.VAT_PURCHASES).eq('company_id', auth.companyId).maybeSingle();
      if (!vatPurchAcc) return error('حساب ضريبة المشتريات (1180) غير موجود');
      vatPurchAccId = vatPurchAcc.id;
    }

    // Insert cash transaction record
    const { data: transaction, error: insertErr } = await s.from('cash_transactions')
      .insert({
        company_id: auth.companyId,
        date,
        type: txnType,
        amount: baseAmount,
        account_id: counterpartAccountId,
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

    // القيد المحاسبي إلزامي متوازن — فشله يلغي الحركة بالكامل
    const journalLines: any[] = [];
    if (txnType === 'revenue') {
      // قبض: مدين النقدية (بالمبلغ الشامل) / دائن الإيراد (الصافي) + ضريبة مخرجات
      const netRevenue = baseAmount - taxAmount;
      journalLines.push({ account_id: cashAccountId, debit: baseAmount, credit: 0, description: description || reason, project_id: projectId || null, contact_id: contactId || null });
      journalLines.push({ account_id: counterpartAccountId, debit: 0, credit: netRevenue, description: description || reason, project_id: projectId || null, contact_id: contactId || null });
      if (taxAmount > 0 && vatSalesAccId) {
        journalLines.push({ account_id: vatSalesAccId, debit: 0, credit: taxAmount, description: `ضريبة مخرجات: ${description || reason}`, project_id: projectId || null, contact_id: contactId || null });
      }
    } else {
      // صرف: مدين المصروف (الصافي) + ضريبة مدخلات / دائن النقدية (الشامل)
      journalLines.push({ account_id: counterpartAccountId, debit: baseAmount, credit: 0, description: description || reason, project_id: projectId || null, contact_id: contactId || null });
      journalLines.push({ account_id: cashAccountId, debit: 0, credit: totalPayment, description: description || reason, project_id: projectId || null, contact_id: contactId || null });
      if (expenseTaxAmount > 0 && vatPurchAccId) {
        journalLines.push({ account_id: vatPurchAccId, debit: expenseTaxAmount, credit: 0, description: `ضريبة مدخلات: ${description || reason}`, project_id: projectId || null, contact_id: contactId || null });
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

    if (je.error || !je.journalId) {
      await s.from('cash_transactions').delete().eq('id', (transaction as any).id).eq('company_id', auth.companyId);
      throw je.error || new Error('فشل قيد الحركة النقدية');
    }

    const { data: linked, error: linkErr } = await s.from('cash_transactions')
      .update({ journal_entry_id: je.journalId })
      .eq('id', (transaction as any).id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();
    if (linkErr) throw linkErr;

    return success(linked, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
