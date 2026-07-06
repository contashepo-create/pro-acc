import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const result = await query(
      `SELECT r.*, b.name as bank_safe_name
       FROM bank_reconciliation r
       LEFT JOIN banks_safes b ON b.id = r.bank_safe_id
       WHERE r.company_id = $1
       ORDER BY r.date DESC`,
      [auth.companyId]
    );
    return success(result.rows);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const { bankSafeId, date, closingBalance, items } = await parseBody(req);
    if (!auth.companyId || !bankSafeId || !date || closingBalance === undefined) {
      return error('companyId, bankSafeId, date, closingBalance are required');
    }

    const result = await query(
      `INSERT INTO bank_reconciliation (company_id, bank_safe_id, date, closing_balance)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [auth.companyId, bankSafeId, date, closingBalance]
    );
    const rec = result.rows[0];

    if (items && items.length > 0) {
      for (const item of items) {
        await query(
          `INSERT INTO bank_reconciliation_items (company_id, reconciliation_id, transaction_type, amount, date, is_cleared)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [auth.companyId, rec.id, item.transactionType, item.amount, item.date ?? date, item.isCleared ?? false]
        );
      }
    }

    return success(rec);
  } catch (err) {
    return handleApiError(err);
  }
}
