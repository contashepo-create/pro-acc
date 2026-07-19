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

    if (!name || !hire_date) {
      return error('name and hire_date are required');
    }

    const { data: result, error: insertError } = await s.from('employees')
      .insert({
        company_id: auth.companyId,
        name,
        phone: phone || null,
        email: email || null,
        salary: salary || 0,
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
