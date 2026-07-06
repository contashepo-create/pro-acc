import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const warehouseId = url.searchParams.get('warehouseId');
    const type = url.searchParams.get('type');
    const itemId = url.searchParams.get('itemId');

    if (url.searchParams.has('warehouses')) {
      const warehouses = await query(
        `SELECT * FROM warehouses WHERE company_id = $1 ORDER BY name`,
        [auth.companyId]
      );
      return success({ warehouses: warehouses.rows });
    }

    if (url.searchParams.has('items')) {
      const items = await query(
        `SELECT i.*, w.name as warehouse_name FROM inventory_items i
         LEFT JOIN warehouses w ON i.warehouse_id = w.id
         WHERE i.company_id = $1 AND i.is_active = true ORDER BY i.name`,
        [auth.companyId]
      );
      return success({ items: items.rows });
    }

    const conditions = ['i.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;

    if (warehouseId) { conditions.push(`i.warehouse_id = $${idx}`); params.push(warehouseId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM inventory_items i WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const items = await query(
      `SELECT i.*, w.name as warehouse_name FROM inventory_items i
       LEFT JOIN warehouses w ON i.warehouse_id = w.id
       WHERE ${where} ORDER BY i.name LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ items: items.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { code, name, unit, warehouse_id, category } = data;

    if (!code || !name || !unit || !warehouse_id) {
      return error('company_id, code, name, unit, warehouse_id are required');
    }

    const existing = await query(
      `SELECT id FROM inventory_items WHERE company_id = $1 AND code = $2`,
      [auth.companyId, code]
    );
    if (existing.rows.length > 0) return error('كود الصنف موجود مسبقاً');

    const result = await query(
      `INSERT INTO inventory_items (company_id, code, name, unit, warehouse_id, category, quantity, unit_price, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, true) RETURNING *`,
      [auth.companyId, code, name, unit, warehouse_id, category || null]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
