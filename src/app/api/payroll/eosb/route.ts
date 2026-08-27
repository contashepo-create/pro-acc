import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/payroll/eosb — ترحيل استحقاق نهاية الخدمة الشهري (IAS 19 / نظام العمل).
 * الجسم: { date: 'YYYY-MM-01' } (أول الشهر إجبارياً — الدالة ترفض غيره).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'payroll', 'create');
    const body = await parseBody<{ date?: unknown }>(req);
    const date = typeof body.date === 'string' ? body.date : '';
    if (!DATE_RE.test(date)) return error('تاريخ الاستحقاق غير صالح (YYYY-MM-01)');
    const { data, error: rpcError } = await getSupabase().rpc('accrue_eosb_batch', {
      p_company_id: auth.companyId,
      p_month_date: date,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}

/** GET — سجل الاستحقاقات السابقة */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'payroll', 'read');
    const { data, error: queryError } = await getSupabase()
      .from('eosb_accruals')
      .select('id, employee_id, date, gross_salary, service_years, amount, journal_entry_id, created_at')
      .eq('company_id', auth.companyId)
      .order('date', { ascending: false })
      .range(0, 499);
    if (queryError) throw queryError;
    return success({ accruals: data || [] });
  } catch (cause) {
    return handleApiError(cause);
  }
}
