import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'salary_sheets', 'read');
    const s = sb();
    const { data, error: queryError } = await s.from('salary_sheets')
      .select('*').eq('company_id', auth.companyId).order('year', { ascending: false }).order('month', { ascending: false });
    if (queryError) throw queryError;
    return success(data || []);
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'salary_sheets', 'create');
    const s = sb();
    const { name, month, year, date, items } = await parseBody(req);
    if (!name || !Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12 || !Number.isInteger(Number(year)) || Number(year) < 2000 || Number(year) > 9999) return error('بيانات كشف الرواتب غير صالحة');
    if (items !== undefined && !Array.isArray(items)) return error('بنود كشف الرواتب غير صالحة');

    const { data: sheet, error: sheetErr } = await s.from('salary_sheets')
      .insert({ company_id: auth.companyId, name, month, year, date: date ?? new Date().toISOString().split('T')[0] })
      .select('*').single();
    if (sheetErr) throw sheetErr;

    if (items && items.length > 0) {
      for (const item of items) {
        if (!item?.employeeId) throw new Error('موظف بند الراتب مطلوب');
        const { data: employee } = await s.from('employees').select('id')
          .eq('id', item.employeeId).eq('company_id', auth.companyId).maybeSingle();
        if (!employee) throw new Error('موظف بند الراتب لا ينتمي إلى الشركة');
        const basic = Number(item.basicSalary ?? 0);
        const allowances = Number(item.allowances ?? 0);
        const deductions = Number(item.deductions ?? 0);
        if (![basic, allowances, deductions].every(Number.isFinite) || basic < 0 || allowances < 0 || deductions < 0) {
          throw new Error('مبالغ بند الراتب غير صالحة');
        }
        const netPay = basic + allowances - deductions;
        if (netPay < 0) throw new Error('صافي الراتب لا يمكن أن يكون سالباً');
        await s.from('salary_items').insert({
          company_id: auth.companyId, sheet_id: sheet.id, employee_id: item.employeeId,
          basic_salary: basic, allowances, deductions, net_pay: netPay,
        });
      }
    }
    return success(sheet);
  } catch (err) { return handleApiError(err); }
}
