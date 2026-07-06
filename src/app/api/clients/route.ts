import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireApiAuth } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const contactId = url.searchParams.get('contactId');

    const conditions = ['c.company_id = $1', "c.type IN ('client', 'both')"];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (contactId) { conditions.push(`c.id = $${idx}`); params.push(contactId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM contacts c WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const clients = await query(
      `SELECT c.*, a.code as account_code, a.name as account_name,
        COALESCE(SUM(jl.debit - jl.credit), 0) as balance
       FROM contacts c
       LEFT JOIN accounts a ON c.account_id = a.id
       LEFT JOIN journal_lines jl ON jl.contact_id = c.id
       WHERE ${where}
       GROUP BY c.id, a.code, a.name
       ORDER BY c.name LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ clients: clients.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { name, phone, email, address, tax_number, commercial_registration, credit_limit } = data;
    const company_id = auth.companyId;

    if (!name) return error('name is required');

    const result = await query(
      `INSERT INTO contacts (company_id, name, type, phone, email, address, tax_number, commercial_registration, credit_limit, is_active)
       VALUES ($1, $2, 'client', $3, $4, $5, $6, $7, $8, true) RETURNING *`,
      [company_id, name, phone || null, email || null, address || null, tax_number || null, commercial_registration || null, credit_limit || 0]
    );

    return success(result.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
