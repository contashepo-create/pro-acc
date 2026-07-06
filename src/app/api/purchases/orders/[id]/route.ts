import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const po = await query(
      `SELECT po.*, c.name as supplier_name FROM purchase_orders po
       LEFT JOIN contacts c ON po.supplier_id = c.id WHERE po.id = $1`,
      [id]
    );
    if (po.rows.length === 0) return notFound();

    const items = await query(
      `SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`,
      [id]
    );
    po.rows[0].items = items.rows;

    return success(po.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const data = await parseBody(req);

    const existing = await query(`SELECT status FROM purchase_orders WHERE id = $1`, [id]);
    if (existing.rows.length === 0) return notFound();
    if (existing.rows[0].status !== 'pending') return error('لا يمكن تعديل أمر شراء تم استلامه');

    const result = await transaction(async (client) => {
      let total = 0;
      if (data.items) {
        await client.query(`DELETE FROM purchase_order_items WHERE purchase_order_id = $1`, [id]);
        for (const item of data.items) {
          total += (item.quantity || 0) * (item.unit_price || 0);
          await client.query(
            `INSERT INTO purchase_order_items (purchase_order_id, description, quantity, unit_price, total)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, item.description, item.quantity, item.unit_price, item.quantity * item.unit_price]
          );
        }
      }

      const updated = await client.query(
        `UPDATE purchase_orders SET supplier_id = COALESCE($1, supplier_id), date = COALESCE($2, date),
         total = $3, notes = COALESCE($4, notes), updated_at = NOW()
         WHERE id = $5 RETURNING *`,
        [data.supplier_id, data.date, total || existing.rows[0].total, data.notes, id]
      );
      return updated.rows[0];
    });

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

    const result = await transaction(async (client) => {
      const po = await client.query(`SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE`, [id]);
      if (po.rows.length === 0) throw new Error('Not found');
      if (po.rows[0].status === 'cancelled') throw new Error('أمر الشراء ملغي');

      const items = await client.query(
        `SELECT * FROM purchase_order_items WHERE purchase_order_id = $1`, [id]
      );

      for (const item of items.rows) {
        const receivedQty = parseFloat(item.received_quantity) || 0;
        const qty = parseFloat(item.quantity) || 0;
        if (receivedQty >= qty) continue;

        const receiveQty = data.quantities?.[item.id] || (qty - receivedQty);
        const newReceived = Math.min(receivedQty + receiveQty, qty);

        await client.query(
          `UPDATE purchase_order_items SET received_quantity = $1 WHERE id = $2`,
          [newReceived, item.id]
        );

        const invItem = await client.query(
          `SELECT id, quantity, unit_price FROM inventory_items
           WHERE company_id = $1 AND code = $2 LIMIT 1`,
          [po.rows[0].company_id, item.description]
        );

        if (invItem.rows.length > 0) {
          const curQty = parseFloat(invItem.rows[0].quantity) || 0;
          const curPrice = parseFloat(invItem.rows[0].unit_price) || 0;
          const newQty = curQty + receiveQty;
          const newPrice = curQty === 0 ? item.unit_price : ((curQty * curPrice) + (receiveQty * item.unit_price)) / newQty;

          await client.query(
            `UPDATE inventory_items SET quantity = $1, unit_price = $2 WHERE id = $3`,
            [newQty, newPrice, invItem.rows[0].id]
          );
        } else {
          await client.query(
            `INSERT INTO inventory_items (company_id, code, name, unit, warehouse_id, quantity, unit_price, is_active)
             VALUES ($1, $2, $3, 'وحدة', (SELECT id FROM warehouses WHERE company_id = $1 LIMIT 1), $4, $5, true)`,
            [po.rows[0].company_id, item.description, item.description, receiveQty, item.unit_price]
          );
        }

        await client.query(
          `INSERT INTO inventory_transactions (company_id, item_id, warehouse_id, type, quantity, unit_price, total_value, date, reference_type, reference_id, created_by)
           VALUES ($1, $2, (SELECT warehouse_id FROM inventory_items WHERE id = $2), 'add', $3, $4, $5, $6, 'purchase_order', $7, $8)`,
          [po.rows[0].company_id, invItem.rows[0]?.id, receiveQty, item.unit_price, receiveQty * item.unit_price,
           data.date || po.rows[0].date, id, auth.userId]
        );
      }

      const allReceived = await client.query(
        `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE received_quantity >= quantity) as done
         FROM purchase_order_items WHERE purchase_order_id = $1`, [id]
      );
      const { total: t, done } = allReceived.rows[0];
      const newStatus = parseInt(done, 10) === parseInt(t, 10) ? 'received' : 'partial';

      const updated = await client.query(
        `UPDATE purchase_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [newStatus, id]
      );
      return updated.rows[0];
    });

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const po = await query(`SELECT status FROM purchase_orders WHERE id = $1`, [id]);
    if (po.rows.length === 0) return notFound();

    const received = await query(
      `SELECT id FROM purchase_order_items WHERE purchase_order_id = $1 AND received_quantity > 0 LIMIT 1`,
      [id]
    );
    if (received.rows.length > 0) return error('لا يمكن إلغاء أمر شراء تم استلام جزء منه');

    await query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`, [id]);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
