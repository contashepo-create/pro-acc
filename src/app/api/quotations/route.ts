import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    const conditions = ['q.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (status) { conditions.push(`q.status = $${idx}`); params.push(status); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM quotations q WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const quotations = await query(
      `SELECT q.*, c.name as contact_name FROM quotations q
       LEFT JOIN contacts c ON q.contact_id = c.id
       WHERE ${where} ORDER BY q.date DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    for (const q of quotations.rows) {
      const items = await query(
        `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY id`, [q.id]
      );
      q.items = items.rows;
    }

    return success({ quotations: quotations.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { date, contact_id, items, notes, tax_rate, valid_until } = data;

    if (!date || !contact_id || !items || items.length === 0) {
      return error('company_id, date, contact_id, items are required');
    }

    let subtotal = 0;
    for (const item of items) {
      subtotal += (item.quantity || 0) * (item.unit_price || 0);
    }
    const rate = tax_rate || 0;
    const taxAmount = subtotal * rate;
    const total = subtotal + taxAmount;

    const seq = await query(
      `SELECT COALESCE(MAX(number), 0) + 1 as next_num FROM quotations WHERE company_id = $1`,
      [auth.companyId]
    );
    const nextNum = seq.rows[0].next_num;

    const result = await query(
      `INSERT INTO quotations (company_id, number, date, contact_id, subtotal, tax_amount, tax_rate, total, notes, valid_until, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11) RETURNING *`,
      [auth.companyId, nextNum, date, contact_id, subtotal, taxAmount, rate, total, notes, valid_until, auth.userId]
    );

    for (const item of items) {
      await query(
        `INSERT INTO quotation_items (quotation_id, description, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.rows[0].id, item.description, item.quantity, item.unit_price, item.quantity * item.unit_price]
      );
    }

    const full = await query(
      `SELECT q.*, c.name as contact_name FROM quotations q
       LEFT JOIN contacts c ON q.contact_id = c.id WHERE q.id = $1`,
      [result.rows[0].id]
    );
    full.rows[0].items = items;

    return success(full.rows[0], 201);
  } catch (err) {
    return handleApiError(err);
  }
}
