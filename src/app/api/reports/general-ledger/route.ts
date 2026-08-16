import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';
import { parseReportPagination } from '@/lib/report-validation';

const sb = () => getSupabase();
const number = (value: unknown) => Number(value) || 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Paginated general ledger with database-side totals and running balance. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const accountId = url.searchParams.get('account_id');
    const accountCode = url.searchParams.get('account_code');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const costCenterId = url.searchParams.get('cost_center_id');
    const branchId = url.searchParams.get('branch_id');
    const pagination = parseReportPagination(url.searchParams);
    if (!pagination) return error('بيانات التصفح غير صالحة');
    const { page, pageSize } = pagination;
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');
    if ((accountId && !uuid.test(accountId)) || (costCenterId && !uuid.test(costCenterId)) || (branchId && !uuid.test(branchId))) return error('معرّف المرشح غير صالح');

    let account: any = null;
    if (accountId || accountCode) {
      let query = s.from('accounts').select('id, code, name, type').eq('company_id', auth.companyId);
      query = accountId ? query.eq('id', accountId) : query.eq('code', accountCode!);
      const result = await query.maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return error('الحساب غير موجود', 404);
      account = result.data;
    }
    if (costCenterId) {
      const { data, error: costCenterError } = await s.from('cost_centers').select('id')
        .eq('id', costCenterId).eq('company_id', auth.companyId).maybeSingle();
      if (costCenterError) throw costCenterError;
      if (!data) return error('مركز التكلفة غير موجود', 404);
    }
    if (branchId) {
      const { data, error: branchError } = await s.from('branches').select('id')
        .eq('id', branchId).eq('company_id', auth.companyId).maybeSingle();
      if (branchError) throw branchError;
      if (!data) return error('الفرع غير موجود', 404);
    }

    const calls: any[] = [s.rpc('get_general_ledger', {
      p_company_id: auth.companyId, p_account_id: account?.id || null,
      p_from: from, p_to: to, p_cost_center_id: costCenterId, p_branch_id: branchId,
      p_limit: pageSize, p_offset: (page - 1) * pageSize,
    })];
    if (from && account) calls.push(s.rpc('get_account_opening_balance', {
      p_company_id: auth.companyId, p_account_id: account.id, p_before: from,
      p_cost_center_id: costCenterId, p_branch_id: branchId,
    }));
    const [ledgerResult, openingResult] = await Promise.all(calls);
    if (ledgerResult.error) throw ledgerResult.error;
    if (openingResult?.error) throw openingResult.error;
    const rows = ledgerResult.data || [];
    const openingBalance = openingResult ? number(openingResult.data) : (rows.length ? number(rows[0].opening_balance) : 0);
    const totalDebit = rows.length ? number(rows[0].total_debit) : 0;
    const totalCredit = rows.length ? number(rows[0].total_credit) : 0;
    const total = rows.length ? number(rows[0].total_count) : 0;
    const transactions = rows.map((row: any) => ({
      id: row.line_id, date: row.entry_date, number: row.entry_number,
      description: row.entry_description || row.line_description,
      reference_type: row.reference_type, reference_id: row.reference_id,
      account_id: row.account_id, account_code: row.account_code, account_name: row.account_name,
      debit: number(row.debit), credit: number(row.credit), balance: number(row.running_balance),
      cost_center_id: row.cost_center_id, branch_id: row.branch_id,
    }));
    const closingBalance = account
      ? openingBalance + (['asset', 'expense'].includes(account.type) ? totalDebit - totalCredit : totalCredit - totalDebit)
      : totalDebit - totalCredit;

    return success({
      account, opening_balance: openingBalance, transactions,
      total_debit: totalDebit, total_credit: totalCredit, closing_balance: closingBalance,
      count: total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
