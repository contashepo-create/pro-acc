import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);

    const years = await query(
      `SELECT * FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC`,
      [auth.companyId]
    );
    return success({ fiscalYears: years.rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const data = await parseBody(request);
    const { name, start_date, end_date } = data;

    if (!name || !start_date || !end_date) {
      return error('name, start_date, end_date are required');
    }

    const overlap = await query(
      `SELECT id FROM fiscal_years WHERE company_id = $1 AND $2 <= end_date AND $3 >= start_date LIMIT 1`,
      [auth.companyId, start_date, end_date]
    );
    if (overlap.rows.length > 0) return error('الفترة المالية تتداخل مع فترة موجودة');

    const result = await query(
      `INSERT INTO fiscal_years (company_id, name, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, 'open') RETURNING *`,
      [auth.companyId, name, start_date, end_date]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
