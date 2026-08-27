import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { inventoryItemSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_COLUMNS = 'id, code, name, unit, quantity, unit_price, warehouse_id, category, is_active, updated_at, warehouses!warehouse_id(name)';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'inventory', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const warehouseId = url.searchParams.get('warehouseId');
    if (warehouseId && !UUID_RE.test(warehouseId)) return error('معرّف المستودع غير صالح');

    if (url.searchParams.has('warehouses')) {
      const { data, error: warehouseError } = await sb().from('warehouses')
        .select('id, name, location').eq('company_id', auth.companyId).eq('is_active', true).order('name').range(0, 499);
      if (warehouseError) throw warehouseError;
      return success({ warehouses: data || [], truncated: (data || []).length === 500 });
    }

    let query = sb().from('inventory_items').select(ITEM_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);
    if (url.searchParams.has('items')) query = query.eq('is_active', true);
    const effectivePage = url.searchParams.has('items') ? 1 : page;
    const effectivePageSize = url.searchParams.has('items') ? 500 : pageSize;
    const offset = (effectivePage - 1) * effectivePageSize;
    const { data, error: queryError, count } = await query.order('name').range(offset, offset + effectivePageSize - 1);
    if (queryError) throw queryError;
    const items = (data || []).map((item: Record<string, unknown>) => ({
      ...item,
      warehouse_name: (item.warehouses as { name?: string } | null)?.name || null,
      warehouses: undefined,
    }));
    return success({ items, total: count || 0, page: effectivePage, pageSize: effectivePageSize,
      truncated: url.searchParams.has('items') && (count || 0) > effectivePageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'inventory', 'create');
    const parsed = inventoryItemSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_inventory_item_atomic', {
      p_company_id: auth.companyId,
      p_code: parsed.data.code,
      p_name: parsed.data.name,
      p_unit: parsed.data.unit,
      p_warehouse_id: parsed.data.warehouse_id,
      p_category: parsed.data.category || null,
      p_user_id: auth.userId,
    });
    const message = String(createError?.message || '');
    if (message.includes('المستودع غير موجود')) return error('المستودع غير موجود', 404);
    if (message.includes('كود الصنف موجود')) return error('كود الصنف موجود مسبقاً في المستودع', 409);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
