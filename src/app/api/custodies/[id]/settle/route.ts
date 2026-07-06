import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, notFound } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = (await params);
    const data = await parseBody(req);
    const { settlement_amount, description, created_by } = data;

    if (!settlement_amount) return error('settlement_amount is required');

    const result = await transaction(async (client) => {
      const custody = await client.query(`SELECT * FROM custodies WHERE id = $1 FOR UPDATE`, [id]);
      if (custody.rows.length === 0) throw new Error('Not found');
      if (custody.rows[0].status !== 'open') throw new Error('العهدة مقفلة بالفعل');

      const amount = parseFloat(custody.rows[0].amount);
      const settlement = parseFloat(settlement_amount);
      const shortage = amount - settlement;

      await client.query(
        `UPDATE custodies SET settlement_amount = $1, settlement_date = $2, status = 'settled',
         settlement_description = $3, updated_at = NOW() WHERE id = $4`,
        [settlement, data.date || new Date().toISOString().split('T')[0], description, id]
      );

      const expenseAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [custody.rows[0].company_id, ACCOUNT_CODES.EMPLOYEE_CUSTODIES]
      );

      const je = await client.query(
        `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
         VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
         $2, 'general', $3, $4) RETURNING *`,
        [custody.rows[0].company_id, data.date || new Date().toISOString().split('T')[0],
         `تسوية عهدة: ${custody.rows[0].description || ''}`, created_by]
      );
      const jeId = je.rows[0].id;

      if (settlement > 0) {
        const bankAccount = await client.query(
          `SELECT account_id FROM banks_safes WHERE id = $1`,
          [custody.rows[0].bank_safe_id]
        );
        if (bankAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [jeId, bankAccount.rows[0].account_id, settlement]
          );
        }
      }

      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
        [jeId, expenseAccount.rows[0].id, amount]
      );

      if (shortage > 0) {
        const shortageAcct = await client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
          [custody.rows[0].company_id, ACCOUNT_CODES.DIRECT_COSTS]
        );
        if (shortageAcct.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [jeId, shortageAcct.rows[0].id, shortage]
          );
        }
      }

      return { ...custody.rows[0], settlement_amount: settlement, status: 'settled' };
    });

    return success(result);
  } catch (e) {
    return serverError(e);
  }
}
