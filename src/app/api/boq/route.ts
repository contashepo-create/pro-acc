import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const projectId = req.nextUrl.searchParams.get('projectId');
    const { page, pageSize } = getPaginationParams(req.url);

    const conditions = ['b.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (projectId) { conditions.push(`b.project_id = $${idx}`); params.push(projectId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM boq_items b WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const items = await query(
      `SELECT b.*, p.name as project_name FROM boq_items b
       LEFT JOIN projects p ON b.project_id = p.id
       WHERE ${where} ORDER BY b.item_code
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ boqItems: items.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { project_id, item_code, description, unit, quantity, unit_price } = data;

    if (!auth.companyId || !project_id || !item_code || !description || !unit || !quantity || unit_price == null) {
      return error('company_id, project_id, item_code, description, unit, quantity, unit_price are required');
    }

    const result = await query(
      `INSERT INTO boq_items (company_id, project_id, item_code, description, unit, quantity, unit_price, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [auth.companyId, project_id, item_code, description, unit, quantity, unit_price, quantity * unit_price]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
