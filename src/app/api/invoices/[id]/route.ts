import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound, parseBody } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

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

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const ctx = await getCompanyAndUser(request);
    if (!ctx) return unauthorized();

    const invRes = await query(
      `SELECT i.id, i.number, i.contact_id, i.project_id, i.date, i.due_date,
              i.subtotal, i.vat_rate, i.vat_amount, i.total, i.status,
              i.notes, i.journal_entry_id, i.created_by, i.created_at,
              COALESCE(c.name, '') as client_name
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [id, ctx.companyId]
    );

    if (invRes.rows.length === 0) return notFound();

    const itemsRes = await query(
      `SELECT id, description, quantity, unit_price, total
       FROM invoice_items
       WHERE invoice_id = $1
       ORDER BY id`,
      [id]
    );

    return success({
      ...invRes.rows[0],
      items: itemsRes.rows,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const ctx = await getCompanyAndUser(request);
    if (!ctx) return unauthorized();

    const body = await parseBody<{ status: string; notes?: string }>(request);

    const invRes = await query(
      `SELECT id, number, total, status, journal_entry_id
       FROM invoices
       WHERE id = $1 AND company_id = $2`,
      [id, ctx.companyId]
    );

    if (invRes.rows.length === 0) return notFound();

    const invoice = invRes.rows[0];

    if (body.status === 'paid') {
      if (invoice.status === 'paid') {
        return error('الفاتورة مدفوعة مسبقاً');
      }
      if (invoice.status === 'cancelled') {
        return error('لا يمكن دفع فاتورة ملغية');
      }

      await query(
        `UPDATE invoices SET status = 'paid', updated_at = NOW()::timestamp WHERE id = $1`,
        [id]
      );

      return success({ message: 'تم تسجيل الفاتورة كمدفوعة' });
    }

    if (body.status === 'cancelled') {
      if (invoice.status === 'cancelled') {
        return error('الفاتورة ملغية مسبقاً');
      }

      await transaction(async (client) => {
        await client.query(
          `UPDATE invoices SET status = 'cancelled', notes = COALESCE($1, notes), updated_at = NOW()::timestamp
           WHERE id = $2`,
          [body.notes || null, id]
        );

        if (invoice.journal_entry_id) {
          const year = new Date().getFullYear().toString();

          await client.query(
            `INSERT INTO journal_sequences (company_id, year, last_number)
             VALUES ($1, $2, 1)
             ON CONFLICT (company_id, year) DO NOTHING`,
            [ctx.companyId, year]
          );

          const seqRes = await client.query(
            `UPDATE journal_sequences
             SET last_number = last_number + 1
             WHERE company_id = $1 AND year = $2
             RETURNING last_number`,
            [ctx.companyId, year]
          );
          const reversalNumber = seqRes.rows[0].last_number;

          const reversalRes = await client.query(
            `INSERT INTO journal_entries (company_id, number, date, type, description, reference, created_by)
             VALUES ($1, $2, CURRENT_DATE, 'general', $3, $4, $5)
             RETURNING id`,
            [
              ctx.companyId,
              reversalNumber,
              `قيد عكسي لفاتورة رقم ${invoice.number}`,
              `REV-${invoice.number}`,
              ctx.userId,
            ]
          );
          const reversalEntryId = reversalRes.rows[0].id;

          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
             SELECT $1, account_id, account_code, credit, debit, 'عكس: ' || COALESCE(description, '')
             FROM journal_lines
             WHERE journal_entry_id = $2`,
            [reversalEntryId, invoice.journal_entry_id]
          );
        }
      });

      return success({ message: 'تم إلغاء الفاتورة بنجاح' });
    }

    return error('حالة غير صالحة. الحالات المسموحة: paid, cancelled');
  } catch (err) {
    return serverError(err);
  }
}
