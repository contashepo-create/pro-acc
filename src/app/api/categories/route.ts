import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireApiAuth } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const total = await query(`SELECT COUNT(*) as cnt FROM transaction_categories WHERE company_id = $1`, [auth.companyId]);
    const offset = (page - 1) * pageSize;

    const categories = await query(
      `SELECT tc.*, a.code as account_code, a.name as account_name
       FROM transaction_categories tc
       LEFT JOIN accounts a ON tc.account_id = a.id
       WHERE tc.company_id = $1 ORDER BY tc.name
       LIMIT $2 OFFSET $3`,
      [auth.companyId, pageSize, offset]
    );

    return success({ categories: categories.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { name, type, account_id } = data;
    const company_id = auth.companyId;

    if (!name || !type || !account_id) {
      return error('name, type, account_id are required');
    }

    const result = await query(
      `INSERT INTO transaction_categories (company_id, name, type, account_id, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [company_id, name, type, account_id]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
