import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { contract_id, certificate_id, amount, date, bank_safe_id, notes } = data;

    if (!auth.companyId || !contract_id || !amount || !date || !bank_safe_id) {
      return error('company_id, contract_id, amount, date, bank_safe_id are required');
    }

    const result = await transaction(async (client) => {
      const payment = await client.query(
        `INSERT INTO subcon_payments (company_id, contract_id, certificate_id, amount, date, bank_safe_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [auth.companyId, contract_id, certificate_id || null, amount, date, bank_safe_id, notes, auth.userId]
      );

      const apAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES]
      );
      const bankAccount = await client.query(
        `SELECT account_id FROM banks_safes WHERE id = $1`,
        [bank_safe_id]
      );

      if (apAccount.rows.length > 0 && bankAccount.rows.length > 0) {
        const je = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
           VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
           $2, 'general', $3, $4) RETURNING *`,
          [auth.companyId, date, `دفعة مقاول باطن`, auth.userId]
        );

        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
          [je.rows[0].id, apAccount.rows[0].id, amount]
        );
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
          [je.rows[0].id, bankAccount.rows[0].account_id, amount]
        );
      }

      return payment.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
