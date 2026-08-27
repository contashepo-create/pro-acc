import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { warehouseSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const COLUMNS = 'id, name, location, is_active';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'read');
    const { data, error: queryError } = await sb().from('warehouses').select(COLUMNS)
      .eq('company_id', auth.companyId).order('name').range(0, 499);
    if (queryError) throw queryError;
    return success({ warehouses: data || [], truncated: (data || []).length === 500 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'create');
    const parsed = warehouseSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_warehouse_atomic', {
      p_company_id: auth.companyId,
      p_name: parsed.data.name,
      p_location: parsed.data.location || null,
      p_user_id: auth.userId,
    });
    const message = String(createError?.message || '');
    if (message.includes('warehouse plan limit')) return error('تم الوصول للحد الأقصى من المستودعات في الباقة الحالية', 403);
    if (message.includes('اسم المستودع مستخدم')) return error('اسم المستودع مستخدم مسبقاً', 409);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
