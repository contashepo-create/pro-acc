import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextPurchaseOrderNumber } from '@/lib/numbering';
import { purchaseOrderSchema } from '@/lib/validation';

const sb = () => getSupabase();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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
        .in('purchase_order_id', ids);
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

    // TENANT CHECK: المورد يجب أن ينتمي لهذه الشركة (قبل أي كتابة)
    const { data: supplier } = await s.from('contacts')
      .select('id').eq('id', supplier_id).eq('company_id', auth.companyId).maybeSingle();
    if (!supplier) return error('المورد غير موجود', 404);

    // الإجمالي يُحسب خادمياً — إجمالي العميل (إن أُرسل) يُتجاهل
    const computedItems = items.map((it) => ({
      ...it,
      total: round2(it.quantity * it.unit_price),
    }));
    const total = round2(computedItems.reduce((sum, it) => sum + it.total, 0));

    // ترقيم ذري عبر RPC مع قفل استشاري
    const nextNum = await getNextPurchaseOrderNumber(auth.companyId);

    const { data: po, error: poErr } = await s.from('purchase_orders')
      .insert({ company_id: auth.companyId, po_number: nextNum, date, supplier_id, total, status: 'pending', notes: notes || null, created_by: auth.userId })
      .select('*').single();
    if (poErr) throw poErr;

    try {
      for (const item of computedItems) {
        const { error: itemErr } = await s.from('purchase_order_items').insert({
          company_id: auth.companyId,
          purchase_order_id: po.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.total,
        });
        if (itemErr) throw itemErr;
      }
    } catch (itemInsertErr) {
      // لا أمر شراء يتيم بدون بنود
      await s.from('purchase_order_items').delete().eq('purchase_order_id', po.id);
      await s.from('purchase_orders').delete().eq('id', po.id).eq('company_id', auth.companyId);
      throw itemInsertErr;
    }

    return success(po, 201);
  } catch (err) { return handleApiError(err); }
}
