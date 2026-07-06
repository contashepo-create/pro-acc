import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, parseBody } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { invoiceSchema } from '@/lib/validation';

async function getCompanyAndUser(request: NextRequest): Promise<{ companyId: string; userId: string } | null> {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const res = await query(
    'SELECT company_id, id as user_id FROM users WHERE id = $1 AND is_active = true',
    [payload.userId]
  );
  return res.rows.length > 0 ? { companyId: res.rows[0].company_id, userId: res.rows[0].user_id } : null;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getCompanyAndUser(request);
    if (!ctx) return unauthorized();

    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const status = url.searchParams.get('status');
    const clientId = url.searchParams.get('client_id');
    const dateFrom = url.searchParams.get('from');
    const dateTo = url.searchParams.get('to');

    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [ctx.companyId];
    let paramIdx = 2;

    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }
    if (clientId) {
      conditions.push(`contact_id = $${paramIdx++}`);
      params.push(clientId);
    }
    if (dateFrom) {
      conditions.push(`date >= $${paramIdx++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`date <= $${paramIdx++}`);
      params.push(dateTo);
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await query(
      `SELECT COUNT(*)::int as total FROM invoices WHERE ${whereClause}`,
      params
    );
    const total = countRes.rows[0].total;

    params.push(pageSize, (page - 1) * pageSize);

    const res = await query(
      `SELECT i.id, i.number, i.contact_id, i.project_id, i.date, i.due_date,
              i.subtotal, i.vat_rate, i.vat_amount, i.total, i.status,
              i.notes, i.journal_entry_id, i.created_at,
              COALESCE(c.name, '') as client_name
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE ${whereClause}
       ORDER BY i.date DESC, i.number DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    return success({
      invoices: res.rows,
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
    const ctx = await getCompanyAndUser(request);
    if (!ctx) return unauthorized();

    const body = await parseBody(request);
    const parsed = invoiceSchema.safeParse(body);
    if (!parsed.success) {
      return error(parsed.error.issues[0].message);
    }

    const { clientId, projectId, date, dueDate, items, subtotal, vatRate, vatAmount, total, notes } = parsed.data;

    const result = await transaction(async (client) => {
      const year = date.substring(0, 4);

      await client.query(
        `INSERT INTO invoice_sequences (company_id, year, last_number)
         VALUES ($1, $2, 1)
         ON CONFLICT (company_id, year) DO NOTHING`,
        [ctx.companyId, year]
      );

      const seqRes = await client.query(
        `UPDATE invoice_sequences
         SET last_number = last_number + 1
         WHERE company_id = $1 AND year = $2
         RETURNING last_number`,
        [ctx.companyId, year]
      );
      const number = seqRes.rows[0].last_number;

      const computedVat = vatAmount ?? subtotal * vatRate;
      const computedTotal = total ?? subtotal + computedVat;

      const invoiceRes = await client.query(
        `INSERT INTO invoices (company_id, number, contact_id, project_id, date, due_date,
                               subtotal, vat_rate, vat_amount, total, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unpaid', $11, $12)
         RETURNING id, number, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes`,
        [ctx.companyId, number, clientId, projectId || null, date, dueDate,
         subtotal, vatRate, computedVat, computedTotal, notes || null, ctx.userId]
      );
      const invoice = invoiceRes.rows[0];

      for (const item of items) {
        const itemTotal = item.total ?? item.quantity * item.unitPrice;
        await client.query(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total)
           VALUES ($1, $2, $3, $4, $5)`,
          [invoice.id, item.description, item.quantity, item.unitPrice, itemTotal]
        );
      }

      const arAccountRes = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = '1130'`,
        [ctx.companyId]
      );

      const revenueAccountRes = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = '4100'`,
        [ctx.companyId]
      );

      const vatAccountRes = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = '2120'`,
        [ctx.companyId]
      );

      if (arAccountRes.rows.length === 0 || revenueAccountRes.rows.length === 0) {
        throw new Error('الحسابات الأساسية مفقودة. يرجى التأكد من وجود حسابات العملاء (1130) والإيرادات (4100)');
      }

      const jeRes = await client.query(
        `INSERT INTO journal_entries (company_id, number, date, type, description, reference, created_by)
         VALUES ($1, $2, $3, 'general', $4, $5, $6)
         RETURNING id`,
        [
          ctx.companyId,
          number,
          date,
          `فاتورة مبيعات رقم ${number}`,
          `INV-${number}`,
          ctx.userId,
        ]
      );
      const journalEntryId = jeRes.rows[0].id;

      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
         VALUES ($1, $2, '1130', $3, 0, 'فاتورة مبيعات رقم ${number}')`,
        [journalEntryId, arAccountRes.rows[0].id, computedTotal]
      );

      await client.query(
        `INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
         VALUES ($1, $2, '4100', 0, $3, 'إيراد فاتورة رقم ${number}')`,
        [journalEntryId, revenueAccountRes.rows[0].id, subtotal]
      );

      if (computedVat > 0 && vatAccountRes.rows.length > 0) {
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
           VALUES ($1, $2, '2120', 0, $3, 'ضريبة فاتورة رقم ${number}')`,
          [journalEntryId, vatAccountRes.rows[0].id, computedVat]
        );
      }

      await client.query(
        `UPDATE invoices SET journal_entry_id = $1 WHERE id = $2`,
        [journalEntryId, invoice.id]
      );

      const itemsRes = await client.query(
        `SELECT id, description, quantity, unit_price, total FROM invoice_items WHERE invoice_id = $1`,
        [invoice.id]
      );

      return { ...invoice, items: itemsRes.rows, journalEntryId };
    });

    return success(result, 201);
  } catch (err: any) {
    if (err.message?.includes('مفقودة')) {
      return error(err.message);
    }
    return serverError(err);
  }
}
