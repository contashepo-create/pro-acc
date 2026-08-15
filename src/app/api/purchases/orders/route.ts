import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseOrderSchema } from '@/lib/validation';

const sb = () => getSupabase();


export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');
    const supplierId = url.searchParams.get('supplierId');

    let query = s.from('purchase_orders')
      .select('*, contacts(name)', { count: 'exact' }).eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);
    if (supplierId) query = query.eq('supplier_id', supplierId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const orders = (data || []).map((po: any) => ({
      ...po,
      supplier_name: po.contacts?.name || null,
      items: [] as any[],
    }));

    // Batch-load items for the whole page (was an N+1 loop)
    const ids = orders.map((o: any) => o.id).filter(Boolean);
    if (ids.length > 0) {
      const { data: allItems } = await s.from('purchase_order_items')
        .select('*')
        .in('purchase_order_id', ids)
        .eq('company_id', auth.companyId);
      const itemsByOrder = new Map<string, any[]>();
      for (const it of allItems || []) {
        const list = itemsByOrder.get(it.purchase_order_id) || [];
        list.push(it);
        itemsByOrder.set(it.purchase_order_id, list);
      }
      for (const o of orders) o.items = itemsByOrder.get(o.id) || [];
    }

    return success({ orders, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

/**
 * POST /api/purchases/orders
 * تحقق Zod + انتماء المورد للشركة + حساب الإجمالي خادمياً.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'create');
    const s = sb();

    const body = await parseBody(req);
    const parsed = purchaseOrderSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { date, supplier_id, items, notes } = parsed.data;

    // Supplier validation, numbering, totals, parent and child inserts are one
    // database transaction. A line failure can no longer leave an orphan PO.
    const { data: po, error: poErr } = await s.rpc('create_purchase_order_atomic', {
      p_company_id: auth.companyId,
      p_supplier_id: supplier_id,
      p_date: date,
      p_items: items,
      p_notes: notes || '',
      p_user_id: auth.userId,
    });
    if (poErr) throw poErr;
    return success(po, 201);
  } catch (err) { return handleApiError(err); }
}
