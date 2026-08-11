import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseOrderUpdateSchema, purchaseReceiveSchema } from '@/lib/validation';

const sb = () => getSupabase();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * GET /api/purchases/orders/[id]
 * TENANT: مقيد بالشركة — المعرف وحده لم يعد كافياً للقراءة.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'read');
    const { id } = await params;
    const s = sb();

    const { data: po, error: poError } = await s.from('purchase_orders')
      .select('*, contacts!supplier_id(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (poError || !po) return notFound();

    // السجلات الفرعية تابعة لأبٍ تحققنا من ملكيته
    const { data: items } = await s.from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', id)
      .order('id');

    return success({
      ...po,
      supplier_name: (po as Record<string, any>).contacts?.name || null,
      items: items || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/purchases/orders/[id]
 * تعديل أمر معلّق فقط — مقيد بالشركة مع إعادة حساب الإجمالي خادمياً.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'update');
    const { id } = await params;
    const s = sb();

    const body = await parseBody(req);
    const parsed = purchaseOrderUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { data: existing } = await s.from('purchase_orders')
      .select('id, status, total, supplier_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();
    if ((existing as Record<string, any>).status !== 'pending') {
      return error('لا يمكن تعديل أمر شراء تم استلامه أو إلغاؤه');
    }

    // انتماء المورد الجديد (إن تغيّر) لهذه الشركة
    if (parsed.data.supplier_id) {
      const { data: supplier } = await s.from('contacts')
        .select('id').eq('id', parsed.data.supplier_id).eq('company_id', auth.companyId).maybeSingle();
      if (!supplier) return error('المورد غير موجود', 404);
    }

    let newTotal: number | undefined;
    if (parsed.data.items) {
      await s.from('purchase_order_items').delete().eq('purchase_order_id', id);
      let sum = 0;
      for (const item of parsed.data.items) {
        const lineTotal = round2(item.quantity * item.unit_price);
        sum += lineTotal;
        const { error: itemErr } = await s.from('purchase_order_items').insert({
          company_id: auth.companyId,
          purchase_order_id: id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: lineTotal,
        });
        if (itemErr) throw itemErr;
      }
      newTotal = round2(sum);
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (parsed.data.supplier_id !== undefined) updateData.supplier_id = parsed.data.supplier_id;
    if (parsed.data.date !== undefined) updateData.date = parsed.data.date;
    if (newTotal !== undefined) updateData.total = newTotal;
    if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

    const { data: result, error: updateError } = await s.from('purchase_orders')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .maybeSingle();

    if (updateError || !result) return notFound();
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PATCH /api/purchases/orders/[id] — استلام بضاعة
 * FIXES:
 * - صلاحية وحدة purchase_orders (كان أي مستخدم موثّق يستلم ويحدّث المخزون!)
 * - عزل الشركة على الأمر (كان قبولاً متقاطعاً بين المستأجرين)
 * - كمية الاستلام تُحصر بالمتبقي قبل استخدامها في المخزون (كان التضخيم ممكناً)
 * - الكميات السالبة مرفوضة بالمخطط (كانت تخصم من المخزون — ثغرة سرقة)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'update');
    const { id } = await params;
    const s = sb();

    const body = await parseBody(req);
    const parsed = purchaseReceiveSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const data = parsed.data;

    const { data: po } = await s.from('purchase_orders')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!po) return notFound();
    if (po.status === 'cancelled') return error('أمر الشراء ملغي');

    const { data: items } = await s.from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', id);

    for (const item of (items || [])) {
      const receivedQty = parseFloat(item.received_quantity) || 0;
      const qty = parseFloat(item.quantity) || 0;
      const remaining = qty - receivedQty;
      if (remaining <= 0) continue;

      // الحصر بالمتبقي يحدث قبل أي استخدام — في التخزين وفي المخزون معاً
      const requested = data.quantities?.[item.id];
      const receiveQty = Math.min(requested ?? remaining, remaining);
      if (receiveQty <= 0) continue;

      await s.from('purchase_order_items')
        .update({ received_quantity: receivedQty + receiveQty })
        .eq('id', item.id);

      // تحديث المخزون — المطابقة الحالية code = description
      // (قيد تصميمي موثق؛ الربط المباشر بالأصناف ضمن مراجعة قسم المخزون)
      const { data: invItem } = await s.from('inventory_items')
        .select('id, quantity, unit_price, warehouse_id')
        .eq('company_id', po.company_id)
        .eq('code', item.description)
        .maybeSingle();

      if (invItem) {
        const curQty = parseFloat(invItem.quantity) || 0;
        const curPrice = parseFloat(invItem.unit_price) || 0;
        const newQty = curQty + receiveQty;
        const newPrice = curQty === 0
          ? item.unit_price
          : ((curQty * curPrice) + (receiveQty * item.unit_price)) / newQty;

        await s.from('inventory_items')
          .update({ quantity: newQty, unit_price: newPrice })
          .eq('id', invItem.id)
          .eq('company_id', po.company_id);

        await s.from('inventory_transactions').insert({
          company_id: po.company_id,
          item_id: invItem.id,
          warehouse_id: invItem.warehouse_id || null,
          type: 'add',
          quantity: receiveQty,
          unit_price: item.unit_price,
          total_value: receiveQty * item.unit_price,
          date: data.date || po.date,
          reference_type: 'purchase_order',
          reference_id: id,
          created_by: auth.userId,
        });
      } else {
        // إنشاء صنف جديد عند الاستلام (السلوك الحالي — موثق)
        const { data: wh } = await s.from('warehouses')
          .select('id')
          .eq('company_id', po.company_id)
          .limit(1)
          .maybeSingle();

        const { data: newItem, error: newItemErr } = await s.from('inventory_items')
          .insert({
            company_id: po.company_id,
            code: item.description,
            name: item.description,
            unit: 'وحدة',
            warehouse_id: wh?.id || null,
            quantity: receiveQty,
            unit_price: item.unit_price,
            is_active: true,
          })
          .select('id')
          .single();

        if (!newItemErr && newItem) {
          await s.from('inventory_transactions').insert({
            company_id: po.company_id,
            item_id: newItem.id,
            warehouse_id: wh?.id || null,
            type: 'add',
            quantity: receiveQty,
            unit_price: item.unit_price,
            total_value: receiveQty * item.unit_price,
            date: data.date || po.date,
            reference_type: 'purchase_order',
            reference_id: id,
            created_by: auth.userId,
          });
        }
      }
    }

    // تحديث الحالة بناءً على الاستلام الفعلي
    const { data: receivedCheck } = await s.from('purchase_order_items')
      .select('quantity, received_quantity')
      .eq('purchase_order_id', id);

    let allReceived = true;
    for (const rc of (receivedCheck || [])) {
      if ((parseFloat(rc.received_quantity) || 0) < (parseFloat(rc.quantity) || 0)) {
        allReceived = false;
        break;
      }
    }

    const newStatus = allReceived ? 'received' : 'partial';
    const { data: updated, error: updErr } = await s.from('purchase_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .maybeSingle();

    if (updErr) throw updErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/purchases/orders/[id] — إلغاء ناعم (لا حذف صلب)
 * مقيد بالشركة ومدير فما فوق؛ ممنوع عند وجود استلام جزئي.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    const s = sb();

    const { data: po } = await s.from('purchase_orders')
      .select('id, status')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!po) return notFound();

    const { data: received } = await s.from('purchase_order_items')
      .select('id')
      .eq('purchase_order_id', id)
      .gt('received_quantity', 0)
      .limit(1);

    if (received && received.length > 0) {
      return error('لا يمكن إلغاء أمر شراء تم استلام جزء منه');
    }

    await s.from('purchase_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', auth.companyId);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
