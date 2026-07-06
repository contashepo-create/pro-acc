import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const employeeId = url.searchParams.get('employeeId');

    const conditions = ['c.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (from) { conditions.push(`c.date >= $${idx}`); params.push(from); idx++; }
    if (to) { conditions.push(`c.date <= $${idx}`); params.push(to); idx++; }
    if (employeeId) { conditions.push(`c.employee_id = $${idx}`); params.push(employeeId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM custodies c WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const custodies = await query(
      `SELECT c.*, e.name as employee_name, b.name as bank_name
       FROM custodies c
       LEFT JOIN employees e ON c.employee_id = e.id
       LEFT JOIN banks_safes b ON c.bank_safe_id = b.id
       WHERE ${where} ORDER BY c.date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ custodies: custodies.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { employee_id, date, amount, bank_safe_id, description } = data;

    if (!auth.companyId || !employee_id || !date || !amount || !bank_safe_id) {
      return error('company_id, employee_id, date, amount, bank_safe_id are required');
    }

    const result = await transaction(async (client) => {
      const custody = await client.query(
        `INSERT INTO custodies (company_id, employee_id, date, amount, bank_safe_id, description, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7) RETURNING *`,
        [auth.companyId, employee_id, date, amount, bank_safe_id, description, auth.userId]
      );

      const custodyAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.EMPLOYEE_CUSTODIES]
      );
      const bankAccount = await client.query(
        `SELECT account_id FROM banks_safes WHERE id = $1`,
        [bank_safe_id]
      );

      if (custodyAccount.rows.length > 0 && bankAccount.rows.length > 0) {
        const je = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
           VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
           $2, 'general', $3, $4) RETURNING *`,
          [auth.companyId, date, `عهدة: ${description || ''}`, auth.userId]
        );

        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
          [je.rows[0].id, custodyAccount.rows[0].id, amount]
        );
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
          [je.rows[0].id, bankAccount.rows[0].account_id, amount]
        );
      }

      return custody.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
