import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { data, error: queryError } = await s.from('salary_sheets')
      .select('*').eq('company_id', auth.companyId).order('year', { ascending: false }).order('month', { ascending: false });
    if (queryError) throw queryError;
    return success(data || []);
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { name, month, year, date, items } = await parseBody(req);
    if (!name || !month || !year) return error('name, month, year are required');

    const { data: sheet, error: sheetErr } = await s.from('salary_sheets')
      .insert({ company_id: auth.companyId, name, month, year, date: date ?? new Date().toISOString().split('T')[0] })
      .select('*').single();
    if (sheetErr) throw sheetErr;

    if (items && items.length > 0) {
      for (const item of items) {
        await s.from('salary_items').insert({
          company_id: auth.companyId, sheet_id: sheet.id, employee_id: item.employeeId,
          basic_salary: item.basicSalary ?? 0, allowances: item.allowances ?? 0,
          deductions: item.deductions ?? 0, net_pay: item.netPay ?? 0,
        });
      }
    }
    return success(sheet);
  } catch (err) { return handleApiError(err); }
}
