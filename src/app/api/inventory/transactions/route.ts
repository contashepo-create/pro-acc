import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { applyStockMovement } from '@/lib/stock-movements';
import { inventoryMovementSchema } from '@/lib/validation';
import { isValidDate } from '@/lib/utils';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['add', 'issue', 'adjustment', 'transfer', 'return']);
const COLUMNS = 'id, item_id, warehouse_id, to_warehouse_id, type, quantity, unit_price, total_value, balance_before, balance_after, reference_type, reference_id, project_id, notes, date, created_by, created_at, inventory_items!item_id(name, code), warehouses!warehouse_id(name)';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'inventory_transactions', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const itemId = url.searchParams.get('itemId');
    const warehouseId = url.searchParams.get('warehouseId');
    const requestedType = url.searchParams.get('type');
    const type = requestedType === 'adjust' ? 'adjustment' : requestedType;
    if ((itemId && !UUID_RE.test(itemId)) || (warehouseId && !UUID_RE.test(warehouseId))) return error('معرّف الفلتر غير صالح');
    if (type && !TYPES.has(type)) return error('نوع الحركة غير صالح');
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');

    let query = sb().from('inventory_transactions').select(COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (itemId) query = query.eq('item_id', itemId);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);
    if (type) query = query.eq('type', type);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    const offset = (page - 1) * pageSize;
    const { data, count, error: queryError } = await query.order('date', { ascending: false })
      .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const transactions = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      item_name: (row.inventory_items as { name?: string } | null)?.name || null,
      item_code: (row.inventory_items as { code?: string } | null)?.code || null,
      warehouse_name: (row.warehouses as { name?: string } | null)?.name || null,
      inventory_items: undefined,
      warehouses: undefined,
    }));
    return success({ transactions, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'inventory_transactions', 'create');
    const parsed = inventoryMovementSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const result = await applyStockMovement(auth.companyId, auth.userId, parsed.data);
    if (result.error) return error(result.error, result.status || 400);
    return success(result.transaction, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
