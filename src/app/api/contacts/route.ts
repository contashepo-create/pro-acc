import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireApiAuth } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const type = url.searchParams.get('type');

    const conditions = ['c.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (type) { conditions.push(`c.type = $${idx}`); params.push(type); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM contacts c WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const contacts = await query(
      `SELECT c.*, a.code as account_code, a.name as account_name
       FROM contacts c LEFT JOIN accounts a ON c.account_id = a.id
       WHERE ${where} ORDER BY c.name LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ contacts: contacts.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { name, type, phone, email, address, tax_number, commercial_registration, credit_limit } = data;
    const company_id = auth.companyId;

    if (!name || !type) return error('name and type are required');

    const result = await query(
      `INSERT INTO contacts (company_id, name, type, phone, email, address, tax_number, commercial_registration, credit_limit, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING *`,
      [company_id, name, type, phone || null, email || null, address || null, tax_number || null, commercial_registration || null, credit_limit || 0]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
