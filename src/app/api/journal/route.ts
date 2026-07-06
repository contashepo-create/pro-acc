import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, parseBody } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { journalEntrySchema } from '@/lib/validation';

async function getCompanyId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const res = await query('SELECT company_id, id as user_id FROM users WHERE id = $1 AND is_active = true', [payload.userId]);
  return res.rows.length > 0 ? res.rows[0].company_id : null;
}

export async function GET(request: NextRequest) {
  try {
    const companyId = await getCompanyId(request);
    if (!companyId) return unauthorized();

    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const dateFrom = url.searchParams.get('date_from') || url.searchParams.get('from');
    const dateTo = url.searchParams.get('date_to') || url.searchParams.get('to');
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('account_id');

    const conditions: string[] = ['je.company_id = $1'];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (dateFrom) {
      conditions.push(`je.date >= $${paramIdx++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`je.date <= $${paramIdx++}`);
      params.push(dateTo);
    }
    if (type) {
      conditions.push(`je.type = $${paramIdx++}`);
      params.push(type);
    }
    if (accountId) {
      conditions.push(`jl.account_code = (SELECT code FROM accounts WHERE id = $${paramIdx} AND company_id = $1)`);
      paramIdx++;
      params.push(accountId);
    }

    const whereClause = accountId
      ? conditions.join(' AND ') + ` AND jl.account_code IS NOT NULL`
      : conditions.join(' AND ');

    const countSql = accountId
      ? `SELECT COUNT(DISTINCT je.id)::int as total
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         WHERE ${conditions.join(' AND ')}`
      : `SELECT COUNT(*)::int as total FROM journal_entries je WHERE ${conditions.join(' AND ')}`;

    const countRes = await query(countSql, params);
    const total = countRes.rows[0].total;

    const dataSql = `
      SELECT je.id, je.number, je.date, je.type, je.description,
             je.reference, je.created_by, je.created_at,
             (SELECT COUNT(*)::int FROM journal_lines WHERE journal_entry_id = je.id) as lines_count,
             (SELECT COALESCE(SUM(debit), 0)::float FROM journal_lines WHERE journal_entry_id = je.id) as total_debit,
             (SELECT COALESCE(SUM(credit), 0)::float FROM journal_lines WHERE journal_entry_id = je.id) as total_credit
      FROM journal_entries je
      ${accountId ? 'JOIN journal_lines jl ON jl.journal_entry_id = je.id' : ''}
      WHERE ${conditions.join(' AND ')}
      ORDER BY je.date DESC, je.number DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(pageSize, (page - 1) * pageSize);

    const res = await query(dataSql, params);

    return success({
      entries: res.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;
    if (!token) return unauthorized();

    const payload = verifyToken(token);
    if (!payload) return unauthorized();

    const userRes = await query(
      'SELECT company_id, id as user_id FROM users WHERE id = $1 AND is_active = true',
      [payload.userId]
    );
    if (userRes.rows.length === 0) return unauthorized();

    const companyId = userRes.rows[0].company_id;
    const userId = userRes.rows[0].user_id;

    const body = await parseBody(request);
    const parsed = journalEntrySchema.safeParse(body);
    if (!parsed.success) {
      return error(parsed.error.issues[0].message);
    }

    const { date, type, description, reference, lines } = parsed.data;

    const result = await transaction(async (client) => {
      const year = date.substring(0, 4);

      await client.query(
        `INSERT INTO journal_sequences (company_id, year, last_number)
         VALUES ($1, $2, 1)
         ON CONFLICT (company_id, year) DO NOTHING`,
        [companyId, year]
      );

      const seqRes = await client.query(
        `UPDATE journal_sequences
         SET last_number = last_number + 1
         WHERE company_id = $1 AND year = $2
         RETURNING last_number`,
        [companyId, year]
      );
      const number = seqRes.rows[0].last_number;

      const entryRes = await client.query(
        `INSERT INTO journal_entries (company_id, number, date, type, description, reference, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, number, date, type, description, reference, created_at`,
        [companyId, number, date, type, description || null, reference || null, userId]
      );
      const entryId = entryRes.rows[0].id;

      for (const line of lines) {
        const accountRes = await client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND code = $2`,
          [companyId, line.accountCode]
        );
        if (accountRes.rows.length === 0) {
          throw new Error(`الحساب برمز ${line.accountCode} غير موجود`);
        }

        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [entryId, accountRes.rows[0].id, line.accountCode, line.debit, line.credit, line.description || null]
        );
      }

      const balanceRes = await client.query(
        `SELECT COALESCE(SUM(debit), 0)::float as total_debit,
                COALESCE(SUM(credit), 0)::float as total_credit
         FROM journal_lines WHERE journal_entry_id = $1`,
        [entryId]
      );

      const { total_debit, total_credit } = balanceRes.rows[0];
      if (Math.abs(total_debit - total_credit) > 0.01) {
        throw new Error(`خطأ في الموازنة: مجموع الديون (${total_debit}) لا يساوي مجموع الدائنين (${total_credit})`);
      }

      const linesRes = await client.query(
        `SELECT jl.id, jl.account_code, a.name as account_name, a.type as account_type,
                jl.debit, jl.credit, jl.description
         FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
         WHERE jl.journal_entry_id = $1
         ORDER BY jl.id`,
        [entryId]
      );

      return {
        ...entryRes.rows[0],
        totalDebit: total_debit,
        totalCredit: total_credit,
        lines: linesRes.rows,
      };
    });

    return success(result, 201);
  } catch (err: any) {
    if (err.message?.includes('غير موجود') || err.message?.includes('الموازنة')) {
      return error(err.message);
    }
    return serverError(err);
  }
}
