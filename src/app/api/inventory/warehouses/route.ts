import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);

    const warehouses = await query(
      `SELECT * FROM warehouses WHERE company_id = $1 ORDER BY name`,
      [auth.companyId]
    );
    return success({ warehouses: warehouses.rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { name, location } = data;

    if (!name) return error('name is required');

    const result = await query(
      `INSERT INTO warehouses (company_id, name, location, is_active)
       VALUES ($1, $2, $3, true) RETURNING *`,
      [auth.companyId, name, location || null]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
