import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { applyStockMovement } from '@/lib/stock-movements';
import { inventoryMovementSchema } from '@/lib/validation';

const sb = () => getSupabase();

/**
 * GET /api/inventory-transactions
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'inventory_transactions', 'read');
    const s = sb();
    const url = new URL(request.url);
    const itemId = url.searchParams.get('itemId');
    const warehouseId = url.searchParams.get('warehouseId');

    let query = s.from('inventory_transactions')
      .select('*, inventory_items(name, code), warehouses(name)')
      .eq('company_id', auth.companyId);

    if (itemId) query = query.eq('item_id', itemId);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);

    const { data: transactions } = await query.order('date', { ascending: false });

    return success({ transactions: transactions || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/inventory-transactions
 * سابقاً: كان يسجّل الحركة فقط دون تحديث رصيد الصنف إطلاقاً —
 * الدفتر يفترق عن المخزون الفعلي مع كل حركة من الواجهة.
 * الآن: يفوّض للمحرك الموحّد applyStockMovement (تحقق + عزل + رصيد + قيود).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'inventory_transactions', 'create');
    const body = await request.json();

    const parsed = inventoryMovementSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const result = await applyStockMovement(auth.companyId, auth.userId, parsed.data);
    if (result.error) return error(result.error, result.status || 400);

    return success(result.transaction, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
