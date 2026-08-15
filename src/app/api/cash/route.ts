import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError, getPaginationParams, getDateRangeParams, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

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

    if (result.error) throw result.error;

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
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !normalizedType || !amount || typeof reason!=='string' || !reason.trim() || reason.length>1000) {
      return error('التاريخ، النوع، المبلغ، والسبب مطلوبة وصحيحة', 400);
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
    const vRate=(tax_enabled && tax_rate!==undefined) ? Number(tax_rate) : 0;
    if (!Number.isFinite(vRate) || vRate<0 || vRate>1 || Math.abs(vRate*10000-Math.round(vRate*10000))>1e-8) {
      return error('نسبة الضريبة غير صالحة');
    }
    if (description!==undefined && (typeof description!=='string' || description.length>2000)) return error('الوصف غير صالح');
    const { data: transaction, error: rpcErr } = await s.rpc('post_cash_transaction', {
      p_company_id: auth.companyId,
      p_date: date,
      p_type: txnType,
      p_amount: parsedAmount,
      p_account_id: accountId || null,
      p_category_id: categoryId || null,
      p_bank_safe_id: bankSafeId,
      p_contact_id: contactId || null,
      p_project_id: projectId || null,
      p_reason: reason.trim(),
      p_description: typeof description==='string' ? description.trim() : '',
      p_tax_rate: vRate,
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(transaction,201);
  } catch (err) {
    return handleApiError(err);
  }
}
