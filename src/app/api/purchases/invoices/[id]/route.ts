import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const pi = await query(
      `SELECT pi.*, c.name as supplier_name, po.po_number
       FROM purchase_invoices pi
       LEFT JOIN contacts c ON pi.supplier_id = c.id
       LEFT JOIN purchase_orders po ON pi.purchase_order_id = po.id
       WHERE pi.id = $1`,
      [id]
    );
    if (pi.rows.length === 0) return notFound();

    const items = await query(
      `SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = $1 ORDER BY id`,
      [id]
    );
    pi.rows[0].items = items.rows;

    const paid = await query(
      `SELECT COALESCE(SUM(amount), 0) as paid_amount FROM disbursement_invoice_items WHERE purchase_invoice_id = $1`,
      [id]
    );
    pi.rows[0].paid_amount = parseFloat(paid.rows[0].paid_amount);

    return success(pi.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const data = await parseBody(req);

    const result = await query(
      `UPDATE purchase_invoices SET status = COALESCE($1, status), notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [data.status, data.notes, id]
    );
    if (result.rows.length === 0) return notFound();
    return success(result.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const inv = await query(`SELECT journal_entry_id FROM purchase_invoices WHERE id = $1`, [id]);
    if (inv.rows.length === 0) return notFound();

    await transaction(async (client) => {
      await client.query(`DELETE FROM purchase_invoice_items WHERE purchase_invoice_id = $1`, [id]);
      await client.query(`DELETE FROM disbursement_invoice_items WHERE purchase_invoice_id = $1`, [id]);

      if (inv.rows[0].journal_entry_id) {
        await client.query(`DELETE FROM journal_lines WHERE journal_entry_id = $1`, [inv.rows[0].journal_entry_id]);
        const revJe = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
           SELECT company_id, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=company_id),
           CURRENT_DATE, 'general', 'عكس فاتورة مشتريات ملغاة', created_by
           FROM journal_entries WHERE id = $1 RETURNING *`,
          [inv.rows[0].journal_entry_id]
        );
        if (revJe.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
             SELECT $1, account_id, credit, debit FROM journal_lines WHERE journal_entry_id = $2`,
            [revJe.rows[0].id, inv.rows[0].journal_entry_id]
          );
        }
      }

      await client.query(`DELETE FROM purchase_invoices WHERE id = $1`, [id]);
    });

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
