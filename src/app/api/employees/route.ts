import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireApiAuth } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const total = await query(`SELECT COUNT(*) as cnt FROM employees WHERE company_id = $1`, [auth.companyId]);
    const offset = (page - 1) * pageSize;

    const employees = await query(
      `SELECT * FROM employees WHERE company_id = $1 ORDER BY name LIMIT $2 OFFSET $3`,
      [auth.companyId, pageSize, offset]
    );

    return success({ employees: employees.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { name, phone, email, salary, department, position, hire_date } = data;
    const company_id = auth.companyId;

    if (!name || !hire_date) {
      return error('name and hire_date are required');
    }

    const result = await query(
      `INSERT INTO employees (company_id, name, phone, email, salary, department, position, hire_date, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING *`,
      [company_id, name, phone || null, email || null, salary || 0, department || null, position || null, hire_date]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
