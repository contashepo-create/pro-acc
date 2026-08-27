import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { inventoryItemUpdateSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_COLUMNS = 'id, code, name, unit, quantity, unit_price, warehouse_id, category, is_active, updated_at, warehouses!warehouse_id(name)';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'inventory', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الصنف غير صالح');
    const { data: item, error: queryError } = await sb().from('inventory_items').select(ITEM_COLUMNS)
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!item) return notFound();
    const row = item as Record<string, unknown>;
    return success({ ...row, warehouse_name: (row.warehouses as { name?: string } | null)?.name || null, warehouses: undefined });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'inventory', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الصنف غير صالح');
    const body = await parseBody<Record<string, unknown>>(request);
    if (body.quantity !== undefined || body.unit_price !== undefined || body.code !== undefined) {
      return error('لا يمكن تعديل الكود أو الكمية أو السعر مباشرة؛ استخدم حركة مخزنية');
    }
    const parsed = inventoryItemUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    if (!Object.keys(parsed.data).length) return error('لا توجد بيانات للتحديث');
    const { data, error: updateError } = await sb().rpc('update_inventory_item_atomic', {
      p_company_id: auth.companyId,
      p_item_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    const message = String(updateError?.message || '');
    if (message.includes('الصنف غير موجود')) return notFound();
    if (message.includes('المستودع غير موجود')) return error('المستودع غير موجود', 404);
    if (message.includes('لا يمكن')) return error(message, 409);
    if (message.includes('كود الصنف موجود')) return error('يوجد الصنف نفسه في المستودع المستهدف', 409);
    if (updateError) throw updateError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الصنف غير صالح');
    const { data, error: deactivateError } = await sb().rpc('update_inventory_item_atomic', {
      p_company_id: auth.companyId,
      p_item_id: id,
      p_patch: { is_active: false },
      p_user_id: auth.userId,
    });
    const message = String(deactivateError?.message || '');
    if (message.includes('الصنف غير موجود')) return notFound();
    if (message.includes('لا يمكن تعطيل')) return error(message, 409);
    if (deactivateError) throw deactivateError;
    return success({ ...((data || {}) as Record<string, unknown>), deactivated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
