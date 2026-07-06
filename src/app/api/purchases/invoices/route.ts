import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const supplierId = url.searchParams.get('supplierId');

    const conditions = ['pi.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (supplierId) { conditions.push(`pi.supplier_id = $${idx}`); params.push(supplierId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM purchase_invoices pi WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const invoices = await query(
      `SELECT pi.*, c.name as supplier_name, po.po_number,
        COALESCE((SELECT SUM(amount) FROM disbursement_invoice_items WHERE purchase_invoice_id = pi.id), 0) as paid_amount
       FROM purchase_invoices pi
       LEFT JOIN contacts c ON pi.supplier_id = c.id
       LEFT JOIN purchase_orders po ON pi.purchase_order_id = po.id
       WHERE ${where} ORDER BY pi.date DESC, pi.id DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    for (const inv of invoices.rows) {
      const items = await query(
        `SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = $1 ORDER BY id`,
        [inv.id]
      );
      inv.items = items.rows;
    }

    return success({ invoices: invoices.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { date, supplier_id, purchase_order_id, items, tax_rate, notes } = data;

    if (!auth.companyId || !date || !supplier_id || !items || items.length === 0) {
      return error('company_id, date, supplier_id, items are required');
    }

    const result = await transaction(async (client) => {
      const seq = await client.query(
        `SELECT COALESCE(MAX(invoice_number), 0) + 1 as next_num FROM purchase_invoices WHERE company_id = $1`,
        [auth.companyId]
      );
      const nextNum = seq.rows[0].next_num;

      let subtotal = 0;
      for (const item of items) {
        subtotal += (item.quantity || 0) * (item.unit_price || 0);
      }
      const rate = tax_rate || 0;
      const taxAmount = subtotal * rate;
      const total = subtotal + taxAmount;

      const pi = await client.query(
        `INSERT INTO purchase_invoices (company_id, invoice_number, date, supplier_id, purchase_order_id,
          subtotal, tax_amount, tax_rate, total, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [auth.companyId, nextNum, date, supplier_id, purchase_order_id || null,
         subtotal, taxAmount, rate, total, notes, auth.userId]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO purchase_invoice_items (purchase_invoice_id, description, quantity, unit_price, total)
           VALUES ($1, $2, $3, $4, $5)`,
          [pi.rows[0].id, item.description, item.quantity, item.unit_price, item.quantity * item.unit_price]
        );

        if (purchase_order_id) {
          await client.query(
            `UPDATE inventory_items SET quantity = quantity + $1, unit_price = CASE WHEN quantity = 0 THEN $2 ELSE ((quantity * unit_price) + ($1 * $2)) / (quantity + $1) END
             WHERE company_id = $3 AND code = $4`,
            [item.quantity, item.unit_price, auth.companyId, item.description]
          );
        }
      }

      const inventoryAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.INVENTORY]
      );
      const apAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.ACCOUNTS_PAYABLE]
      );

      if (inventoryAccount.rows.length > 0 && apAccount.rows.length > 0) {
        const je = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, reference_type, reference_id, created_by)
           VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
           $2, 'general', $3, 'purchase_invoice', $4, $5) RETURNING *`,
          [auth.companyId, date, `فاتورة مشتريات #${nextNum}`, pi.rows[0].id, auth.userId]
        );

        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
          [je.rows[0].id, inventoryAccount.rows[0].id, subtotal]
        );
        if (taxAmount > 0) {
          const vatAccount = await client.query(
            `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
            [auth.companyId, ACCOUNT_CODES.VAT_PURCHASES]
          );
          if (vatAccount.rows.length > 0) {
            await client.query(
              `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
              [je.rows[0].id, vatAccount.rows[0].id, taxAmount]
            );
          }
        }
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
          [je.rows[0].id, apAccount.rows[0].id, total]
        );

        await client.query(`UPDATE purchase_invoices SET journal_entry_id = $1 WHERE id = $2`,
          [je.rows[0].id, pi.rows[0].id]);
      }

      return pi.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
