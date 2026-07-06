import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const result = await query(
      'SELECT * FROM currencies WHERE company_id = $1 ORDER BY is_base DESC, code',
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
    const { code, name, rate, isBase } = await parseBody(req);
    const companyId = auth.companyId;
    if (!code || !name) return error('code and name are required');

    const result = await query(
      `INSERT INTO currencies (company_id, code, name, rate, is_base)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [companyId, code, name, rate ?? 1, isBase ?? false]
    );
    return success(result.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}
