import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

import type { Row } from '@/lib/types';

const number = (value: unknown) => Number(value) || 0;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');
    const { data, error: queryError } = await getSupabase().rpc('get_account_period_totals', {
      p_company_id: auth.companyId, p_account_type: 'expense', p_from: from, p_to: to,
    });
    if (queryError) throw queryError;
    const categories = ((data ?? []) as Row[]).map((row: Row) => ({
      id: row.account_id, code: row.code, name: row.name,
      amount: number(String(row.debit)) - number(String(row.credit)),
    })).filter((row) => Math.abs(row.amount) >= 0.005)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const totalExpense = categories.reduce((sum: number, row) => sum + row.amount, 0);
    return success({
      categories: categories.map((row) => ({
        ...row, percentage: totalExpense ? (row.amount / totalExpense) * 100 : 0,
      })),
      total_expense: totalExpense, count: categories.length, period: { from, to },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
