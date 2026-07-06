import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { generateId } from '@/lib/utils';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('account_id');
    const contactId = url.searchParams.get('contact_id');

    let whereClause = 'WHERE ct.company_id = $1';
    const params: any[] = [auth.companyId];
    let paramIdx = 2;

    if (dateFrom) {
      whereClause += ` AND ct.date >= $${paramIdx++}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClause += ` AND ct.date <= $${paramIdx++}`;
      params.push(dateTo);
    }
    if (type) {
      whereClause += ` AND ct.type = $${paramIdx++}`;
      params.push(type);
    }
    if (accountId) {
      whereClause += ` AND ct.account_id = $${paramIdx++}`;
      params.push(accountId);
    }
    if (contactId) {
      whereClause += ` AND ct.contact_id = $${paramIdx++}`;
      params.push(contactId);
    }

    const countRes = await query(
      `SELECT COUNT(*) AS total FROM cash_transactions ct ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].total, 10);

    const offset = (page - 1) * pageSize;
    params.push(pageSize);
    params.push(offset);

    const rowsRes = await query(
      `SELECT ct.*, bs.name AS bank_safe_name, a.name AS account_name, c.name AS contact_name
       FROM cash_transactions ct
       LEFT JOIN banks_safes bs ON bs.id = ct.bank_safe_id
       LEFT JOIN accounts a ON a.id = ct.account_id
       LEFT JOIN contacts c ON c.id = ct.contact_id
       ${whereClause}
       ORDER BY ct.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      params
    );

    return success({
      rows: rowsRes.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const body = await parseBody<{
      date: string;
      type: string;
      amount: number;
      account_id: string;
      bank_safe_id?: string | null;
      contact_id?: string | null;
      project_id?: string | null;
      category_id?: string | null;
      reason: string;
    }>(request);

    if (!body.date || !body.type || !body.amount || !body.account_id || !body.reason) {
      return error('جميع الحقول المطلوبة يجب أن تكون مدخلة');
    }
    if (body.amount <= 0) {
      return error('المبلغ يجب أن يكون أكبر من صفر');
    }

    const result = await transaction(async (client) => {
      const txId = generateId();
      const jeId = generateId();

      const seqRes = await client.query(
        `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq FROM journal_entries WHERE company_id = $1`,
        [auth.companyId]
      );
      const nextSeq = seqRes.rows[0].next_seq;

      let bankAccountId: string | null = null;
      if (body.bank_safe_id) {
        const bankRes = await client.query(
          `SELECT account_id FROM banks_safes WHERE id = $1 AND company_id = $2`,
          [body.bank_safe_id, auth.companyId]
        );
        if (bankRes.rows.length === 0 || !bankRes.rows[0].account_id) {
          throw new Error('الخزينة/البنك غير موجود');
        }
        bankAccountId = bankRes.rows[0].account_id;
      }

      const desc = `${body.type === 'receipt' ? 'قبض' : 'صرف'}: ${body.reason}`;

      await client.query(
        `INSERT INTO journal_entries (id, company_id, sequence_number, date, type, description, project_id, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [jeId, auth.companyId, nextSeq, body.date, 'cash', desc, body.project_id || null, auth.userId]
      );

      if (body.type === 'receipt') {
        await client.query(
          `INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, description, project_id, contact_id)
           VALUES ($1, $2, $3, $4, 0, $6, $7, $8), ($9, $2, $10, 0, $11, $6, $7, $8)`,
          [
            generateId(), jeId, bankAccountId || body.account_id, body.amount, body.reason,
            body.project_id || null, body.contact_id || null,
            generateId(), jeId, body.account_id, body.amount
          ]
        );
      } else {
        await client.query(
          `INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, description, project_id, contact_id)
           VALUES ($1, $2, $3, $4, 0, $6, $7, $8), ($9, $2, $10, 0, $11, $6, $7, $8)`,
          [
            generateId(), jeId, body.account_id, body.amount, body.reason,
            body.project_id || null, body.contact_id || null,
            generateId(), jeId, bankAccountId || body.account_id, body.amount
          ]
        );
      }

      await client.query(
        `INSERT INTO cash_transactions (id, company_id, date, type, amount, account_id, bank_safe_id, contact_id, project_id, category_id, reason, journal_entry_id, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
        [
          txId, auth.companyId, body.date, body.type, body.amount, body.account_id,
          body.bank_safe_id || null, body.contact_id || null, body.project_id || null,
          body.category_id || null, body.reason, jeId, auth.userId
        ]
      );

      const txRes = await client.query(
        `SELECT ct.*, je.sequence_number AS journal_entry_number
         FROM cash_transactions ct
         LEFT JOIN journal_entries je ON je.id = ct.journal_entry_id
         WHERE ct.id = $1`,
        [txId]
      );

      return txRes.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
