import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { generateId } from '@/lib/utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;

    const contactRes = await query(
      `SELECT c.*, a.code AS account_code, a.name AS account_name
       FROM contacts c
       LEFT JOIN accounts a ON a.id = c.account_id
       WHERE c.id = $1 AND c.company_id = $2`,
      [id, auth.companyId]
    );

    if (contactRes.rows.length === 0) {
      return notFound();
    }

    const contact = contactRes.rows[0];

    let balance = 0;
    let balanceType: string | null = null;

    if (contact.account_id) {
      const balRes = await query(
        `SELECT COALESCE(SUM(debit), 0) AS total_debit, COALESCE(SUM(credit), 0) AS total_credit
         FROM journal_lines
         WHERE account_id = $1 AND journal_entry_id IN (
           SELECT je.id FROM journal_entries je WHERE je.company_id = $2
         )`,
        [contact.account_id, auth.companyId]
      );
      const debit = parseFloat(balRes.rows[0].total_debit);
      const credit = parseFloat(balRes.rows[0].total_credit);
      balance = debit - credit;
      balanceType = balance >= 0 ? 'debit' : 'credit';
    }

    return success({
      ...contact,
      balance: Math.abs(balance),
      balance_type: balanceType,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const body = await request.json();

    const contactRes = await query(
      `SELECT c.* FROM contacts c WHERE c.id = $1 AND c.company_id = $2`,
      [id, auth.companyId]
    );

    if (contactRes.rows.length === 0) {
      return notFound();
    }

    await transaction(async (client) => {
      const updates: string[] = [];
      const updateParams: any[] = [];
      let paramIdx = 1;

      if (body.name !== undefined) {
        updates.push(`name = $${paramIdx++}`);
        updateParams.push(body.name);
      }
      if (body.type !== undefined) {
        updates.push(`type = $${paramIdx++}`);
        updateParams.push(body.type);
      }
      if (body.phone !== undefined) {
        updates.push(`phone = $${paramIdx++}`);
        updateParams.push(body.phone);
      }
      if (body.email !== undefined) {
        updates.push(`email = $${paramIdx++}`);
        updateParams.push(body.email);
      }
      if (body.tax_number !== undefined) {
        updates.push(`tax_number = $${paramIdx++}`);
        updateParams.push(body.tax_number);
      }
      if (body.address !== undefined) {
        updates.push(`address = $${paramIdx++}`);
        updateParams.push(body.address);
      }

      if (updates.length > 0) {
        updateParams.push(id);
        await client.query(
          `UPDATE contacts SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          updateParams
        );
      }

      if (!contactRes.rows[0].account_id) {
        let accountCode: string;
        let accountType: string;
        const type = body.type || contactRes.rows[0].type;
        if (type === 'client') {
          accountCode = '1130';
          accountType = 'asset';
        } else if (type === 'supplier') {
          accountCode = '2110';
          accountType = 'liability';
        } else {
          accountCode = '2150';
          accountType = 'liability';
        }

        const newAccountId = generateId();
        await client.query(
          `INSERT INTO accounts (id, company_id, code, name, type, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, true, NOW())`,
          [newAccountId, auth.companyId, accountCode, body.name || contactRes.rows[0].name, accountType]
        );

        await client.query(
          `UPDATE contacts SET account_id = $1 WHERE id = $2`,
          [newAccountId, id]
        );
      }
    });

    const updated = await query(
      `SELECT c.*, a.code AS account_code, a.name AS account_name
       FROM contacts c
       LEFT JOIN accounts a ON a.id = c.account_id
       WHERE c.id = $1`,
      [id]
    );

    return success(updated.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;

    const contactRes = await query(
      `SELECT c.* FROM contacts c WHERE c.id = $1 AND c.company_id = $2`,
      [id, auth.companyId]
    );

    if (contactRes.rows.length === 0) {
      return notFound();
    }

    const contact = contactRes.rows[0];

    const depRes = await query(
      `SELECT id FROM invoices WHERE contact_id = $1 LIMIT 1`,
      [id]
    );
    if (depRes.rows.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بفواتير');
    }

    const projDepRes = await query(
      `SELECT id FROM projects WHERE client_id = $1 LIMIT 1`,
      [id]
    );
    if (projDepRes.rows.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بمشاريع');
    }

    await transaction(async (client) => {
      if (contact.account_id) {
        await client.query(
          `UPDATE accounts SET is_active = false WHERE id = $1`,
          [contact.account_id]
        );
      }

      await client.query(
        `DELETE FROM contacts WHERE id = $1`,
        [id]
      );
    });

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
