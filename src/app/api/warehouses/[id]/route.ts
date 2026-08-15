import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'read');
    const { id } = await params;
    const s = sb();

    const { data: warehouse } = await s.from('warehouses')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!warehouse) return notFound();

    return success(warehouse);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('warehouses')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200)) {
      return error('اسم المستودع غير صالح');
    }
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.location !== undefined) updateData.location = body.location;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    const { data: updated, error: updateErr } = await s.from('warehouses')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('warehouses')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    // Check if warehouse has inventory items
    const { data: items } = await s.from('inventory_items')
      .select('id')
      .eq('warehouse_id', id)
      .eq('company_id', auth.companyId)
      .limit(1);

    if (items && items.length > 0) {
      return error('لا يمكن حذف المستودع لأنه يحتوي على أصناف');
    }

    await s.from('warehouses').delete().eq('id', id).eq('company_id', auth.companyId);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
