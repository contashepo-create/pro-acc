import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const total = await query(`SELECT COUNT(*) as cnt FROM subcontractor_contracts WHERE company_id = $1`, [auth.companyId]);
    const offset = (page - 1) * pageSize;

    const contracts = await query(
      `SELECT sc.*, c.name as subcontractor_name FROM subcontractor_contracts sc
       LEFT JOIN contacts c ON sc.subcontractor_id = c.id
       WHERE sc.company_id = $1 ORDER BY sc.start_date DESC
       LIMIT $2 OFFSET $3`,
      [auth.companyId, pageSize, offset]
    );

    return success({ contracts: contracts.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { subcontractor_id, contract_number, description, contract_value, start_date, end_date, retention_rate } = data;

    if (!auth.companyId || !subcontractor_id || !contract_number || !contract_value || !start_date) {
      return error('company_id, subcontractor_id, contract_number, contract_value, start_date are required');
    }

    const result = await query(
      `INSERT INTO subcontractor_contracts (company_id, subcontractor_id, contract_number, description,
        contract_value, start_date, end_date, retention_rate, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active') RETURNING *`,
      [auth.companyId, subcontractor_id, contract_number, description || null, contract_value,
       start_date, end_date || null, retention_rate || 0]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
