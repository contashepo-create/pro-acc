import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: po, error: poError } = await s.from('purchase_orders')
      .select('*, contacts!supplier_id(name)')
      .eq('id', id)
      .maybeSingle();

    if (poError || !po) return notFound();

    const { data: items } = await s.from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', id)
      .order('id');

    return success({
      ...po,
      supplier_name: (po as any).contacts?.name || null,
      items: items || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const data = await parseBody(req);
    const s = sb();

    const { data: existing } = await s.from('purchase_orders')
      .select('status, total')
      .eq('id', id)
      .maybeSingle();

    if (!existing) return notFound();
    if (existing.status !== 'pending') return error('لا يمكن تعديل أمر شراء تم استلامه');

    // Delete old items, insert new
    if (data.items) {
      await s.from('purchase_order_items').delete().eq('purchase_order_id', id);
      let total = 0;
      for (const item of data.items) {
        total += (item.quantity || 0) * (item.unit_price || 0);
        await s.from('purchase_order_items').insert({
          purchase_order_id: id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
        });
      }
      data.total = total;
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (data.supplier_id !== undefined) updateData.supplier_id = data.supplier_id;
    if (data.date !== undefined) updateData.date = data.date;
    if (data.total !== undefined) updateData.total = data.total;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const { data: result, error: updateError } = await s.from('purchase_orders')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (updateError || !result) return notFound();
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const data = await parseBody(req);
    const s = sb();

    const { data: po } = await s.from('purchase_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!po) throw new Error('Not found');
    if (po.status === 'cancelled') return error('أمر الشراء ملغي');

    const { data: items } = await s.from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', id);

    for (const item of (items || [])) {
      const receivedQty = parseFloat(item.received_quantity) || 0;
      const qty = parseFloat(item.quantity) || 0;
      if (receivedQty >= qty) continue;

      const receiveQty = data.quantities?.[item.id] || (qty - receivedQty);
      const newReceived = Math.min(receivedQty + receiveQty, qty);

      await s.from('purchase_order_items')
        .update({ received_quantity: newReceived })
        .eq('id', item.id);

      // Update inventory
      const { data: invItem } = await s.from('inventory_items')
        .select('id, quantity, unit_price')
        .eq('company_id', (po as any).company_id)
        .eq('code', item.description)
        .maybeSingle();

      if (invItem) {
        const curQty = parseFloat(invItem.quantity) || 0;
        const curPrice = parseFloat(invItem.unit_price) || 0;
        const newQty = curQty + receiveQty;
        const newPrice = curQty === 0 ? item.unit_price : ((curQty * curPrice) + (receiveQty * item.unit_price)) / newQty;

        await s.from('inventory_items')
          .update({ quantity: newQty, unit_price: newPrice })
          .eq('id', invItem.id);

        // Get warehouse for transaction
        const { data: wh } = await s.from('inventory_items')
          .select('warehouse_id')
          .eq('id', invItem.id)
          .maybeSingle();

        await s.from('inventory_transactions').insert({
          company_id: (po as any).company_id,
          item_id: invItem.id,
          warehouse_id: wh?.warehouse_id || null,
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
        // Create new inventory item
        const { data: wh } = await s.from('warehouses')
          .select('id')
          .eq('company_id', (po as any).company_id)
          .limit(1)
          .maybeSingle();

        const { data: newItem, error: newItemErr } = await s.from('inventory_items')
          .insert({
            company_id: (po as any).company_id,
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
            company_id: (po as any).company_id,
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

    // Update status
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
      .select('*')
      .maybeSingle();

    if (updErr) throw updErr;
    return success(updated);
  } catch (err: any) {
    if (err.message === 'Not found') return notFound();
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: po } = await s.from('purchase_orders')
      .select('status')
      .eq('id', id)
      .maybeSingle();

    if (!po) return notFound();

    const { data: received } = await s.from('purchase_order_items')
      .select('id')
      .eq('purchase_order_id', id)
      .gt('received_quantity', 0)
      .limit(1);

    if (received && received.length > 0) return error('لا يمكن إلغاء أمر شراء تم استلام جزء منه');

    await s.from('purchase_orders')
      .update({ status: 'cancelled' })
      .eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
