import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    const conditions = ['po.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (status) { conditions.push(`po.status = $${idx}`); params.push(status); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM purchase_orders po WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const orders = await query(
      `SELECT po.*, c.name as supplier_name FROM purchase_orders po
       LEFT JOIN contacts c ON po.supplier_id = c.id
       WHERE ${where} ORDER BY po.date DESC, po.id DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    for (const order of orders.rows) {
      const items = await query(
        `SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`,
        [order.id]
      );
      order.items = items.rows;
    }

    return success({ orders: orders.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { date, supplier_id, items, notes } = data;

    if (!auth.companyId || !date || !supplier_id || !items || items.length === 0) {
      return error('company_id, date, supplier_id, items are required');
    }

    const result = await transaction(async (client) => {
      const seq = await client.query(
        `SELECT COALESCE(MAX(po_number), 0) + 1 as next_num FROM purchase_orders WHERE company_id = $1`,
        [auth.companyId]
      );
      const nextNum = seq.rows[0].next_num;

      let total = 0;
      for (const item of items) {
        total += (item.quantity || 0) * (item.unit_price || 0);
      }

      const po = await client.query(
        `INSERT INTO purchase_orders (company_id, po_number, date, supplier_id, total, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) RETURNING *`,
        [auth.companyId, nextNum, date, supplier_id, total, notes, auth.userId]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, description, quantity, unit_price, total)
           VALUES ($1, $2, $3, $4, $5)`,
          [po.rows[0].id, item.description, item.quantity, item.unit_price, item.quantity * item.unit_price]
        );
      }

      return po.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
