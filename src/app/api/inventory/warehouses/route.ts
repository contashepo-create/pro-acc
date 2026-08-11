import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { warehouseSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'warehouses', 'read');
    const s = sb();

    const { data: warehouses } = await s.from('warehouses')
      .select('*')
      .eq('company_id', auth.companyId)
      .order('name');

    return success({ warehouses: warehouses || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'warehouses', 'create');
    const data = await parseBody(req);

    const parsed = warehouseSchema.safeParse(data);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { name, location } = parsed.data;

    const s = sb();
    const { data: result, error: insertError } = await s.from('warehouses')
      .insert({
        company_id: auth.companyId,
        name,
        location: location || null,
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
