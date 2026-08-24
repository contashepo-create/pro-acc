import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseOrderSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['pending', 'partial', 'received', 'cancelled']);
const ORDER_COLUMNS = 'id, number, po_number, date, supplier_id, total, status, notes, created_by, created_at, updated_at, contacts!supplier_id(name)';
const ITEM_COLUMNS = 'id, purchase_order_id, description, quantity, received_quantity, unit_price, total, inventory_item_id';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');
    const supplierId = url.searchParams.get('supplierId');
    if (status && !STATUSES.has(status)) return error('حالة أمر الشراء غير صالحة');
    if (supplierId && !UUID_RE.test(supplierId)) return error('معرّف المورد غير صالح');
    let query = sb().from('purchase_orders').select(ORDER_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);
    if (supplierId) query = query.eq('supplier_id', supplierId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('date', { ascending: false })
      .order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const orders: Array<Record<string, unknown> & { items: Record<string, unknown>[] }> = (data || []).map((row: Record<string, unknown>) => ({
      ...row, supplier_name: (row.contacts as { name?: string } | null)?.name || null,
      contacts: undefined, items: [] as Record<string, unknown>[],
    }));
    const ids = orders.map((order) => String(order.id));
    if (ids.length) {
      const { data: items, error: itemsError } = await sb().from('purchase_order_items').select(ITEM_COLUMNS)
        .in('purchase_order_id', ids).eq('company_id', auth.companyId).order('id');
      if (itemsError) throw itemsError;
      const grouped = new Map<string, Record<string, unknown>[]>();
      for (const item of items || []) {
        const list = grouped.get(String(item.purchase_order_id)) || [];
        list.push(item); grouped.set(String(item.purchase_order_id), list);
      }
      for (const order of orders) order.items = grouped.get(String(order.id)) || [];
    }
    return success({ orders, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'create');
    const parsed = purchaseOrderSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_purchase_order_atomic', {
      p_company_id: auth.companyId,
      p_supplier_id: parsed.data.supplier_id,
      p_date: parsed.data.date,
      p_items: parsed.data.items,
      p_notes: parsed.data.notes || '',
      p_user_id: auth.userId,
    });
    const message = String(createError?.message || '');
    if (message.includes('المورد غير موجود')) return error('المورد غير موجود أو غير نشط', 404);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
