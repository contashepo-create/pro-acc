import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { applyStockMovement } from '@/lib/stock-movements';
import { inventoryMovementSchema } from '@/lib/validation';

const sb = () => getSupabase();

/**
 * GET /api/inventory/transactions — عرض موسّط مع فلاتر التاريخ والنوع
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'inventory_transactions', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const itemId = url.searchParams.get('itemId');
    const warehouseId = url.searchParams.get('warehouseId');
    const type = url.searchParams.get('type');
    const s = sb();

    let query = s.from('inventory_transactions')
      .select('*, inventory_items!inner(name, code), warehouses!left(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (itemId) query = query.eq('item_id', itemId);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);
    if (type) query = query.eq('type', type);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);

    const offset = (page - 1) * pageSize;
    const { data, count, error: queryError } = await query
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const transactions = (data || []).map((txn: any) => ({
      ...txn,
      item_name: txn.inventory_items?.name || null,
      item_code: txn.inventory_items?.code || null,
      warehouse_name: txn.warehouses?.name || null,
    }));

    return success({ transactions, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/inventory/transactions
 * مسار توافقي — يفوّض للمحرك الموحّد نفسه (سلوك متماثل مع api/inventory-transactions)
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'inventory_transactions', 'create');
    const data = await parseBody(req);

    const parsed = inventoryMovementSchema.safeParse(data);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const result = await applyStockMovement(auth.companyId, auth.userId, parsed.data);
    if (result.error) return error(result.error, result.status || 400);

    return success(result.transaction, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
