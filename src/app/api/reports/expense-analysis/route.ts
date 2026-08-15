import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const number = (value: unknown) => Number(value) || 0;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');
    const { data, error: queryError } = await getSupabase().rpc('get_account_period_totals', {
      p_company_id: auth.companyId, p_account_type: 'expense', p_from: from, p_to: to,
    });
    if (queryError) throw queryError;
    const categories = (data || []).map((row: any) => ({
      id: row.account_id, code: row.code, name: row.name,
      amount: number(row.debit) - number(row.credit),
    })).filter((row: any) => Math.abs(row.amount) >= 0.005)
      .sort((a: any, b: any) => Math.abs(b.amount) - Math.abs(a.amount));
    const totalExpense = categories.reduce((sum: number, row: any) => sum + row.amount, 0);
    return success({
      categories: categories.map((row: any) => ({
        ...row, percentage: totalExpense ? (row.amount / totalExpense) * 100 : 0,
      })),
      total_expense: totalExpense, count: categories.length, period: { from, to },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
