import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const projectId = url.searchParams.get('projectId');

    const conditions = ['dw.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (from) { conditions.push(`dw.date >= $${idx}`); params.push(from); idx++; }
    if (to) { conditions.push(`dw.date <= $${idx}`); params.push(to); idx++; }
    if (projectId) { conditions.push(`dw.project_id = $${idx}`); params.push(projectId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM daily_workers dw WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const records = await query(
      `SELECT dw.*, p.name as project_name FROM daily_workers dw
       LEFT JOIN projects p ON dw.project_id = p.id
       WHERE ${where} ORDER BY dw.date DESC, dw.id DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ records: records.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { project_id, date, worker_name, worker_type, daily_rate, hours_worked, notes } = data;

    if (!auth.companyId || !project_id || !date || !worker_name || !daily_rate) {
      return error('company_id, project_id, date, worker_name, daily_rate are required');
    }

    const result = await query(
      `INSERT INTO daily_workers (company_id, project_id, date, worker_name, worker_type, daily_rate, hours_worked, total_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [auth.companyId, project_id, date, worker_name, worker_type || 'worker', daily_rate,
       hours_worked || 8, daily_rate * (hours_worked || 8) / 8, notes, auth.userId]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
