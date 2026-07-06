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
    const disbType = url.searchParams.get('disbursementType');

    const conditions = ['vd.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (from) { conditions.push(`vd.date >= $${idx}`); params.push(from); idx++; }
    if (to) { conditions.push(`vd.date <= $${idx}`); params.push(to); idx++; }
    if (disbType) { conditions.push(`vd.disbursement_type = $${idx}`); params.push(disbType); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM voucher_disbursements vd WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const disbursements = await query(
      `SELECT vd.*, c.name as contact_name, e.name as employee_name, b.name as bank_name, je.number as journal_entry_number
       FROM voucher_disbursements vd
       LEFT JOIN contacts c ON vd.contact_id = c.id
       LEFT JOIN employees e ON vd.employee_id = e.id
       LEFT JOIN banks_safes b ON vd.bank_safe_id = b.id
       LEFT JOIN journal_entries je ON vd.journal_entry_id = je.id
       WHERE ${where} ORDER BY vd.date DESC, vd.number DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    const summary = await query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount
       FROM voucher_disbursements vd WHERE ${conditions.join(' AND ')}`,
      params.slice(0, idx - 2)
    );

    return success({
      disbursements: disbursements.rows,
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
    const { date, disbursement_type, contact_id, employee_id, amount, bank_safe_id, reason, invoice_items } = data;

    if (!date || !disbursement_type || !amount || !bank_safe_id || !reason) {
      return error('date, disbursement_type, amount, bank_safe_id, reason are required');
    }

    const companyId = auth.companyId;
    const userId = auth.userId;

    const result = await transaction(async (client) => {
      const seq = await client.query(
        `SELECT COALESCE(MAX(number), 0) + 1 as next_num FROM voucher_disbursements WHERE company_id = $1`,
        [companyId]
      );
      const nextNum = seq.rows[0].next_num;

      const bankAccount = await client.query(
        `SELECT account_id FROM banks_safes WHERE id = $1`, [bank_safe_id]
      );

      const je = await client.query(
        `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
         VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
         $2, 'general', $3, $4) RETURNING *`,
        [companyId, date, `سند صرف: ${reason}`, userId]
      );
      const jeId = je.rows[0].id;

      if (bankAccount.rows.length > 0) {
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
          [jeId, bankAccount.rows[0].account_id, amount]
        );
      }

      if (disbursement_type === 'supplier' || disbursement_type === 'supplier_advance') {
        const apAccount = await client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
          [companyId, ACCOUNT_CODES.ACCOUNTS_PAYABLE]
        );
        if (apAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [jeId, apAccount.rows[0].id, amount]
          );
        }
      } else if (disbursement_type === 'client_refund') {
        const arAccount = await client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
          [companyId, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE]
        );
        if (arAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [jeId, arAccount.rows[0].id, amount]
          );
        }
      } else if (disbursement_type === 'employee_advance') {
        const advAccount = await client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
          [companyId, ACCOUNT_CODES.EMPLOYEE_ADVANCES]
        );
        if (advAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [jeId, advAccount.rows[0].id, amount]
          );
        }
        if (employee_id) {
          await client.query(
            `INSERT INTO employee_advances (company_id, employee_id, date, type, amount, description)
             VALUES ($1, $2, $3, 'advance', $4, $5)`,
            [companyId, employee_id, date, amount, reason]
          );
        }
      } else if (disbursement_type === 'subcontractor') {
        const subAccount = await client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
          [companyId, ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES]
        );
        if (subAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [jeId, subAccount.rows[0].id, amount]
          );
        }
      } else {
        const expenseAccount = data.account_id;
        if (expenseAccount) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [jeId, expenseAccount, amount]
          );
        }
      }

      if (disbursement_type === 'supplier' && invoice_items && invoice_items.length > 0) {
        for (const item of invoice_items) {
          await client.query(
            `INSERT INTO disbursement_invoice_items (disbursement_voucher_id, purchase_invoice_id, amount)
             VALUES ($1, $2, $3)`,
            [nextNum, item.purchase_invoice_id, item.amount]
          );
        }
      }

      return (await client.query(
        `INSERT INTO voucher_disbursements (company_id, number, date, disbursement_type, contact_id, employee_id, amount, bank_safe_id, reason, journal_entry_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [companyId, nextNum, date, disbursement_type, contact_id || null, employee_id || null,
         amount, bank_safe_id, reason, jeId, userId]
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

    const vd = await query(
      `SELECT * FROM voucher_disbursements WHERE id = $1 AND company_id = $2`,
      [id, auth.companyId]
    );
    if (vd.rows.length === 0) return error('سند الصرف غير موجود');

    await transaction(async (client) => {
      if (vd.rows[0].journal_entry_id) {
        await client.query(`DELETE FROM journal_lines WHERE journal_entry_id = $1`, [vd.rows[0].journal_entry_id]);
        await client.query(`DELETE FROM journal_entries WHERE id = $1`, [vd.rows[0].journal_entry_id]);
      }
      if (vd.rows[0].employee_id && vd.rows[0].disbursement_type === 'employee_advance') {
        await client.query(
          `DELETE FROM employee_advances WHERE employee_id = $1 AND amount = $2 AND type = 'advance' LIMIT 1`,
          [vd.rows[0].employee_id, vd.rows[0].amount]
        );
      }
      await client.query(`DELETE FROM voucher_disbursements WHERE id = $1`, [id]);
    });

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
