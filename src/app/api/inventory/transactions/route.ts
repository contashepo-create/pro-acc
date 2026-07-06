import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const itemId = url.searchParams.get('itemId');
    const warehouseId = url.searchParams.get('warehouseId');
    const type = url.searchParams.get('type');

    const conditions = ['it.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;

    if (itemId) { conditions.push(`it.item_id = $${idx}`); params.push(itemId); idx++; }
    if (warehouseId) { conditions.push(`it.warehouse_id = $${idx}`); params.push(warehouseId); idx++; }
    if (type) { conditions.push(`it.type = $${idx}`); params.push(type); idx++; }
    if (from) { conditions.push(`it.date >= $${idx}`); params.push(from); idx++; }
    if (to) { conditions.push(`it.date <= $${idx}`); params.push(to); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM inventory_transactions it WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const txns = await query(
      `SELECT it.*, i.name as item_name, i.code as item_code, w.name as warehouse_name
       FROM inventory_transactions it
       JOIN inventory_items i ON it.item_id = i.id
       LEFT JOIN warehouses w ON it.warehouse_id = w.id
       WHERE ${where} ORDER BY it.date DESC, it.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ transactions: txns.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { item_id, warehouse_id, type, quantity, unit_price, date, notes, reference_type, reference_id, to_warehouse_id } = data;

    if (!item_id || !warehouse_id || !type || !quantity || !date) {
      return error('company_id, item_id, warehouse_id, type, quantity, date are required');
    }

    const result = await transaction(async (client) => {
      const item = await client.query(`SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE`, [item_id]);
      if (item.rows.length === 0) throw new Error('الصنف غير موجود');

      const currentQty = parseFloat(item.rows[0].quantity) || 0;
      const currentPrice = parseFloat(item.rows[0].unit_price) || 0;
      let newQty = currentQty;
      let newPrice = currentPrice;
      let effectiveWarehouse = warehouse_id;

      switch (type) {
        case 'add': {
          newQty = currentQty + quantity;
          newPrice = currentQty === 0 ? unit_price : ((currentQty * currentPrice) + (quantity * (unit_price || 0))) / newQty;
          break;
        }
        case 'issue': {
          if (currentQty < quantity) throw new Error('الكمية غير متوفرة');
          newQty = currentQty - quantity;
          const costAmount = quantity * currentPrice;
          const inventoryAccount = await client.query(
            `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
            [auth.companyId, ACCOUNT_CODES.INVENTORY]
          );
          const costAccount = await client.query(
            `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
            [auth.companyId, ACCOUNT_CODES.DIRECT_COSTS]
          );
          if (inventoryAccount.rows.length > 0 && costAccount.rows.length > 0) {
            const je = await client.query(
              `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
               VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
               $2, 'general', $3, $4) RETURNING *`,
              [auth.companyId, date, `صرف مخزون: ${item.rows[0].name}`, auth.userId]
            );
            await client.query(
              `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
              [je.rows[0].id, costAccount.rows[0].id, costAmount]
            );
            await client.query(
              `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
              [je.rows[0].id, inventoryAccount.rows[0].id, costAmount]
            );
          }
          break;
        }
        case 'adjust': {
          const diff = quantity - currentQty;
          newQty = quantity;
          const adjustAmount = Math.abs(diff) * currentPrice;
          const inventoryAccount = await client.query(
            `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
            [auth.companyId, ACCOUNT_CODES.INVENTORY]
          );
          if (inventoryAccount.rows.length > 0 && adjustAmount > 0) {
            const je = await client.query(
              `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
               VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
               $2, 'general', $3, $4) RETURNING *`,
              [auth.companyId, date, `تسوية مخزون: ${item.rows[0].name}`, auth.userId]
            );
            if (diff > 0) {
              await client.query(
                `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
                [je.rows[0].id, inventoryAccount.rows[0].id, adjustAmount]
              );
            } else {
              await client.query(
                `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
                [je.rows[0].id, inventoryAccount.rows[0].id, adjustAmount]
              );
            }
          }
          break;
        }
        case 'transfer': {
          if (!to_warehouse_id) throw new Error('المستودع الوجهة مطلوب');
          if (currentQty < quantity) throw new Error('الكمية غير متوفرة');
          newQty = currentQty - quantity;
          await client.query(
            `INSERT INTO inventory_items (company_id, code, name, unit, warehouse_id, quantity, unit_price, category, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
             ON CONFLICT (company_id, code) DO UPDATE SET quantity = inventory_items.quantity + $6`,
             [auth.companyId, item.rows[0].code, item.rows[0].name, item.rows[0].unit,
             to_warehouse_id, quantity, currentPrice, item.rows[0].category]
          );
          effectiveWarehouse = to_warehouse_id;
          break;
        }
        case 'return': {
          newQty = currentQty + quantity;
          break;
        }
        default:
          throw new Error('نوع العملية غير مدعوم');
      }

      await client.query(
        `UPDATE inventory_items SET quantity = $1, unit_price = $2, updated_at = NOW() WHERE id = $3`,
        [newQty, newPrice, item_id]
      );

      const txn = await client.query(
        `INSERT INTO inventory_transactions (company_id, item_id, warehouse_id, type, quantity, unit_price, total_value,
          date, notes, reference_type, reference_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [auth.companyId, item_id, effectiveWarehouse, type, quantity, unit_price || currentPrice,
         quantity * (unit_price || currentPrice), date, notes, reference_type, reference_id, auth.userId]
      );

      return txn.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
