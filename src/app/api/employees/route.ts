import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireApiAuth, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'employees', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await s.from('employees')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .order('name')
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    return success({ employees: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'employees', 'create');
    const s = sb();
    const data = await parseBody(req);
    const { name, phone, email, salary, department, position, hire_date } = data;

    if (typeof name !== 'string' || !name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(hire_date))) {
      return error('الاسم وتاريخ التعيين الصحيح مطلوبان');
    }
    const salaryValue = Number(salary || 0);
    if (!Number.isFinite(salaryValue) || salaryValue<0 || salaryValue!==Math.round(salaryValue*100)/100) return error('الراتب غير صالح');
    if (email && (typeof email !== 'string' || email.length>320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return error('البريد الإلكتروني غير صالح');

    // Check plan limits. Infrastructure errors fail closed so an unavailable
    // entitlement source cannot silently bypass a paid limit.
    const { checkPlanLimit } = await import('@/lib/plan-limits');
    const limitCheck = await checkPlanLimit(auth.companyId, 'employees');
    if (!limitCheck.allowed) {
      return error(limitCheck.message || 'تم الوصول للحد الأقصى من الموظفين', 403);
    }

    const { data: result, error: insertError } = await s.from('employees')
      .insert({
        company_id: auth.companyId,
        name: name.trim(),
        phone: typeof phone === 'string' ? phone.trim() || null : null,
        email: typeof email === 'string' ? email.trim().toLowerCase() || null : null,
        salary: salaryValue,
        department: department || null,
        position: position || null,
        hire_date,
        is_active: true,
      })
      .select('*')
      .single();

    if (insertError) throw insertError;

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
