import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const { page, pageSize } = getPaginationParams(request.url);

    const total = await query(`SELECT COUNT(*) as cnt FROM banks_safes WHERE company_id = $1`, [auth.companyId]);
    const offset = (page - 1) * pageSize;

    const banks = await query(
      `SELECT bs.*, a.code as account_code, a.name as account_name
       FROM banks_safes bs LEFT JOIN accounts a ON bs.account_id = a.id
       WHERE bs.company_id = $1 ORDER BY bs.type, bs.name
       LIMIT $2 OFFSET $3`,
      [auth.companyId, pageSize, offset]
    );

    return success({ banks: banks.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const data = await parseBody(request);
    const { name, type, account_number, account_id, opening_balance } = data;

    if (!name || !type) return error('name, type are required');

    const result = await query(
      `INSERT INTO banks_safes (company_id, name, type, account_number, account_id, opening_balance, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
      [auth.companyId, name, type, account_number || null, account_id || null, opening_balance || 0]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
