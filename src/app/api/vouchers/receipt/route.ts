import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const receiptType = url.searchParams.get('receiptType');

    const conditions = ['vr.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (from) { conditions.push(`vr.date >= $${idx}`); params.push(from); idx++; }
    if (to) { conditions.push(`vr.date <= $${idx}`); params.push(to); idx++; }
    if (receiptType) { conditions.push(`vr.receipt_type = $${idx}`); params.push(receiptType); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM voucher_receipts vr WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const receipts = await query(
      `SELECT vr.*, c.name as contact_name, b.name as bank_name, je.number as journal_entry_number
       FROM voucher_receipts vr
       LEFT JOIN contacts c ON vr.contact_id = c.id
       LEFT JOIN banks_safes b ON vr.bank_safe_id = b.id
       LEFT JOIN journal_entries je ON vr.journal_entry_id = je.id
       WHERE ${where} ORDER BY vr.date DESC, vr.number DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    const summary = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount
       FROM voucher_receipts vr WHERE ${conditions.join(' AND ')}`,
      params.slice(0, idx - 2)
    );

    return success({
      receipts: receipts.rows,
      total: parseInt(total.rows[0].cnt, 10), page, pageSize,
      summary: summary.rows[0],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const data = await parseBody(request);
    const { date, receipt_type, contact_id, amount, bank_safe_id, reason, reference_type, reference_id, invoice_items } = data;

    if (!date || !receipt_type || !amount || !bank_safe_id || !reason) {
      return error('date, receipt_type, amount, bank_safe_id, reason are required');
    }

    const companyId = auth.companyId;
    const userId = auth.userId;

    const result = await transaction(async (client) => {
      const seq = await client.query(
        `SELECT COALESCE(MAX(number), 0) + 1 as next_num FROM voucher_receipts WHERE company_id = $1`,
        [companyId]
      );
      const nextNum = seq.rows[0].next_num;

      if (receipt_type === 'client') {
        let totalAllocated = 0;
        if (invoice_items && invoice_items.length > 0) {
          for (const item of invoice_items) {
            totalAllocated += parseFloat(item.amount) || 0;
            const inv = await client.query(`SELECT * FROM invoices WHERE id = $1`, [item.invoice_id]);
            if (inv.rows.length === 0) throw new Error(`الفاتورة ${item.invoice_id} غير موجودة`);

            const paidSoFar = await client.query(
              `SELECT COALESCE(SUM(amount), 0) as paid FROM receipt_invoice_items WHERE invoice_id = $1`,
              [item.invoice_id]
            );
            const newPaid = parseFloat(paidSoFar.rows[0].paid) + parseFloat(item.amount);
            const total = parseFloat(inv.rows[0].total);
            const newStatus = newPaid >= total ? 'paid' : 'partial';

            await client.query(`UPDATE invoices SET paid_amount = $1, status = $2 WHERE id = $3`,
              [newPaid, newStatus, item.invoice_id]);

            const arAccount = await client.query(
              `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
              [companyId, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE]
            );
            const bankAccount = await client.query(
              `SELECT account_id FROM banks_safes WHERE id = $1`, [bank_safe_id]
            );

            if (arAccount.rows.length > 0 && bankAccount.rows.length > 0) {
              const je = await client.query(
                `INSERT INTO journal_entries (company_id, number, date, type, description, reference_type, reference_id, created_by)
                 VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
                 $2, 'general', $3, 'invoice', $4, $5) RETURNING *`,
                [companyId, date, `دفع فاتورة #${inv.rows[0].number}`, item.invoice_id, userId]
              );
              await client.query(
                `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
                [je.rows[0].id, bankAccount.rows[0].account_id, item.amount]
              );
              await client.query(
                `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
                [je.rows[0].id, arAccount.rows[0].id, item.amount]
              );
            }
          }
        }

        const vr = await client.query(
          `INSERT INTO voucher_receipts (company_id, number, date, receipt_type, contact_id, amount, bank_safe_id, reason, reference_type, reference_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [companyId, nextNum, date, receipt_type, contact_id, totalAllocated, bank_safe_id, reason, reference_type, reference_id, userId]
        );

        if (invoice_items && invoice_items.length > 0) {
          for (const item of invoice_items) {
            await client.query(
              `INSERT INTO receipt_invoice_items (voucher_receipt_id, invoice_id, amount)
               VALUES ($1, $2, $3)`,
              [vr.rows[0].id, item.invoice_id, item.amount]
            );
          }
        }

        return vr.rows[0];
      }

      if (receipt_type === 'supplier_refund') {
        const bankAccount = await client.query(
          `SELECT account_id FROM banks_safes WHERE id = $1`, [bank_safe_id]
        );
        const apAccount = await client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
          [companyId, ACCOUNT_CODES.ACCOUNTS_PAYABLE]
        );
        const je = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
           VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
           $2, 'general', $3, $4) RETURNING *`,
          [companyId, date, `استرداد من مورد: ${reason}`, userId]
        );
        if (bankAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [je.rows[0].id, bankAccount.rows[0].account_id, amount]
          );
        }
        if (apAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
            [je.rows[0].id, apAccount.rows[0].id, amount]
          );
        }

        return (await client.query(
          `INSERT INTO voucher_receipts (company_id, number, date, receipt_type, contact_id, amount, bank_safe_id, reason, journal_entry_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [companyId, nextNum, date, receipt_type, contact_id, amount, bank_safe_id, reason, je.rows[0].id, userId]
        )).rows[0];
      }

      const generalAccount = data.account_id;

      const bankAccount = await client.query(
        `SELECT account_id FROM banks_safes WHERE id = $1`, [bank_safe_id]
      );
      const je = await client.query(
        `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
         VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
         $2, 'general', $3, $4) RETURNING *`,
        [companyId, date, `سند قبض: ${reason}`, userId]
      );

      if (bankAccount.rows.length > 0) {
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
          [je.rows[0].id, bankAccount.rows[0].account_id, amount]
        );
      }
      if (generalAccount) {
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
          [je.rows[0].id, generalAccount, amount]
        );
      }

      return (await client.query(
        `INSERT INTO voucher_receipts (company_id, number, date, receipt_type, contact_id, amount, bank_safe_id, reason, reference_type, reference_id, journal_entry_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [companyId, nextNum, date, receipt_type, contact_id || null, amount, bank_safe_id, reason,
         reference_type || null, reference_id || null, je.rows[0].id, userId]
      )).rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return error('id is required');

    const vr = await query(
      `SELECT * FROM voucher_receipts WHERE id = $1 AND company_id = $2`,
      [id, auth.companyId]
    );
    if (vr.rows.length === 0) return error('سند القبض غير موجود');

    const deps = await query(
      `SELECT id FROM receipt_invoice_items WHERE voucher_receipt_id = $1 LIMIT 1`,
      [id]
    );
    if (deps.rows.length > 0) return error('لا يمكن حذف سند قبض مرتبط بفواتير');

    await transaction(async (client) => {
      if (vr.rows[0].journal_entry_id) {
        await client.query(`DELETE FROM journal_lines WHERE journal_entry_id = $1`, [vr.rows[0].journal_entry_id]);
        await client.query(`DELETE FROM journal_entries WHERE id = $1`, [vr.rows[0].journal_entry_id]);
      }
      await client.query(`DELETE FROM voucher_receipts WHERE id = $1`, [id]);
    });

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
