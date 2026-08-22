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
    if (typeof name !== 'string' || !name.trim() || name.length > 200
      || !Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12
      || !Number.isInteger(Number(year)) || Number(year) < 2000 || Number(year) > 9999) return error('بيانات كشف الرواتب غير صالحة');
    const effectiveDate = date ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return error('تاريخ الكشف غير صالح');
    if (items !== undefined && (!Array.isArray(items) || items.length > 1000)) return error('بنود كشف الرواتب غير صالحة');
    const normalized = (items || []).map((item: any) => ({
      employee_id: item?.employeeId, basic_salary: Number(item?.basicSalary ?? 0),
      allowances: Number(item?.allowances ?? 0), deductions: Number(item?.deductions ?? 0),
      project_id: item?.projectId ?? item?.project_id ?? null,
    }));
    if (normalized.some((item: any) => !item.employee_id || ![item.basic_salary,item.allowances,item.deductions].every((value) => Number.isFinite(value) && value>=0)
      || item.basic_salary+item.allowances-item.deductions<0)
      || new Set(normalized.map((item: any) => item.employee_id)).size!==normalized.length) return error('أحد بنود كشف الرواتب غير صالح أو مكرر');
    if (normalized.some((item: any) => item.project_id && (typeof item.project_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.project_id)))) {
      return error('معرّف المشروع المرتبط بأحد البنود غير صالح');
    }
    if (normalized.length) {
      const employeeIds = normalized.map((item: any) => item.employee_id);
      const projectIds = normalized.map((item: any) => item.project_id).filter(Boolean);
      const { data: employees, error: employeeError } = await s.from('employees').select('id')
        .eq('company_id', auth.companyId).in('id', employeeIds);
      if (employeeError) throw employeeError;
      if ((employees || []).length !== employeeIds.length) return error('أحد الموظفين لا ينتمي إلى الشركة', 404);
      if (projectIds.length) {
        const { data: projects, error: projectError } = await s.from('projects').select('id')
          .eq('company_id', auth.companyId).in('id', projectIds);
        if (projectError) throw projectError;
        if ((projects || []).length !== new Set(projectIds).size) return error('أحد المشاريع المرتبطة لا ينتمي إلى الشركة', 404);
      }
    }
    const { data: sheet, error: rpcErr } = await s.rpc('create_salary_sheet', {
      p_company_id: auth.companyId,
      p_name: name.trim(),
      p_month: Number(month),
      p_year: Number(year),
      p_date: effectiveDate,
      p_items: normalized,
    });
    if (rpcErr) throw rpcErr;
    return success(sheet, 201);
  } catch (err) { return handleApiError(err); }
}
