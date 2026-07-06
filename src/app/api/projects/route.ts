import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, parseBody, getPaginationParams, validationError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { projectSchema } from '@/lib/validation';

const CASH_CUSTOMER_NAME = 'عميل نقدي';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    let whereClause = 'WHERE p.company_id = $1';
    const params: any[] = [auth.companyId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND p.status = $${paramIdx++}`;
      params.push(status);
    }

    const countRes = await query(
      `SELECT COUNT(*) AS total FROM projects p ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].total, 10);

    const offset = (page - 1) * pageSize;
    params.push(pageSize);
    params.push(offset);

    const rowsRes = await query(
      `SELECT p.*, c.name AS client_name
       FROM projects p
       LEFT JOIN contacts c ON c.id = p.client_id
       ${whereClause}
       ORDER BY p.created_at DESC
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
      name: string;
      client_id?: string | null;
      contract_value: number;
      start_date: string;
      end_date?: string | null;
      status?: string;
      description?: string;
      location?: string;
      auto_invoice?: boolean;
    }>(request);

    const parsed = projectSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const result = await transaction(async (client) => {
      const projectId = generateId();
      let effectiveClientId = body.client_id || null;

      if (!effectiveClientId) {
        const cashRes = await client.query(
          `SELECT id FROM contacts WHERE name = $1 AND company_id = $2 AND type = 'client' LIMIT 1`,
            [CASH_CUSTOMER_NAME, auth.companyId]
        );

        if (cashRes.rows.length > 0) {
          effectiveClientId = cashRes.rows[0].id;
        } else {
          const cashContactId = generateId();
          const cashAccountId = generateId();

          const arAccRes = await client.query(
            `SELECT id FROM accounts WHERE code = '1130' AND company_id = $1 LIMIT 1`,
            [auth.companyId]
          );

          await client.query(
            `INSERT INTO accounts (id, company_id, code, name, type, is_active, created_at)
             VALUES ($1, $2, $3, $4, $5, true, NOW())`,
            [cashAccountId, auth.companyId, '1130', CASH_CUSTOMER_NAME, 'asset']
          );

          await client.query(
            `INSERT INTO contacts (id, company_id, name, type, account_id, is_cash_customer, created_at)
             VALUES ($1, $2, $3, $4, $5, true, NOW())`,
            [cashContactId, auth.companyId, CASH_CUSTOMER_NAME, 'client', cashAccountId]
          );

          effectiveClientId = cashContactId;
        }
      }

      await client.query(
        `INSERT INTO projects (id, company_id, name, client_id, contract_value, start_date, end_date, status, description, location, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          projectId, auth.companyId, body.name, effectiveClientId, body.contract_value,
          body.start_date, body.end_date || null, body.status || 'active',
          body.description || null, body.location || null, auth.userId
        ]
      );

      let invoice = null;

      if (body.auto_invoice && effectiveClientId) {
        const invoiceId = generateId();
        const jeId = generateId();
        const invSeqRes = await client.query(
          `          SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq FROM journal_entries WHERE company_id = $1`,
          [auth.companyId]
        );
        const invSeq = invSeqRes.rows[0].next_seq;

        const invoiceNumber = `INV-${projectId.substring(0, 8).toUpperCase()}`;

        await client.query(
          `INSERT INTO journal_entries (id, company_id, sequence_number, date, type, description, project_id, created_by, created_at)
           VALUES ($1, $2, $3, $4, 'invoice', $5, $6, $7, NOW())`,
          [jeId, auth.companyId, invSeq, body.start_date, `فاتورة مشروع: ${body.name}`, projectId, auth.userId]
        );

        const arAccRes = await client.query(
          `SELECT account_id FROM contacts WHERE id = $1`,
          [effectiveClientId]
        );

        if (!arAccRes.rows[0]?.account_id) {
          throw new Error('العميل ليس لديه حساب ذمم مدينة');
        }

        const revAccRes = await client.query(
          `SELECT id FROM accounts WHERE code = '4100' AND company_id = $1 LIMIT 1`,
          [auth.companyId]
        );

        await client.query(
          `INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, description, project_id, contact_id)
           VALUES ($1, $2, $3, $4, 0, $6, $7, $8), ($9, $2, $10, 0, $11, $6, $7, $8)`,
          [
            generateId(), jeId, arAccRes.rows[0].account_id, body.contract_value,
            `فاتورة مشروع: ${body.name}`, projectId, effectiveClientId,
            generateId(), jeId, revAccRes.rows[0].id, body.contract_value
          ]
        );

        await client.query(
          `INSERT INTO invoices (id, company_id, number, contact_id, project_id, date, due_date, subtotal, vat_rate, vat_amount, total, paid_amount, status, notes, journal_entry_id, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
          [
            invoiceId, auth.companyId, invoiceNumber, effectiveClientId, projectId,
            body.start_date, body.start_date, body.contract_value, 0, 0,
            body.contract_value, 0, 'unpaid', null, jeId, auth.userId
          ]
        );

        const invoiceItemId = generateId();
        await client.query(
          `INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, total)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [invoiceItemId, invoiceId, `أعمال مشروع: ${body.name}`, 1, body.contract_value, body.contract_value]
        );

        invoice = { id: invoiceId, number: invoiceNumber };
      }

      const projectRes = await client.query(
        `SELECT p.*, c.name AS client_name
         FROM projects p
         LEFT JOIN contacts c ON c.id = p.client_id
         WHERE p.id = $1`,
        [projectId]
      );

      return { ...projectRes.rows[0], invoice };
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
