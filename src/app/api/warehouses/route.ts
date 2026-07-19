import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'read');
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

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'create');
    const s = sb();
    const body = await request.json();

    if (!body.name) return error('اسم المستودع مطلوب');

    const { data: warehouse, error: insertErr } = await s.from('warehouses')
      .insert({
        id: generateId(),
        company_id: auth.companyId,
        name: body.name,
        location: body.location || null,
        is_active: true,
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    return success(warehouse, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
