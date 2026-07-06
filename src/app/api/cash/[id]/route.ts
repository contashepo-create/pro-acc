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

    const txRes = await query(
      `SELECT ct.*, bs.name AS bank_safe_name, a.name AS account_name, c.name AS contact_name,
              je.sequence_number AS journal_entry_number
       FROM cash_transactions ct
       LEFT JOIN banks_safes bs ON bs.id = ct.bank_safe_id
       LEFT JOIN accounts a ON a.id = ct.account_id
       LEFT JOIN contacts c ON c.id = ct.contact_id
       LEFT JOIN journal_entries je ON je.id = ct.journal_entry_id
       WHERE ct.id = $1 AND ct.company_id = $2`,
      [id, auth.companyId]
    );

    if (txRes.rows.length === 0) {
      return notFound();
    }

    return success(txRes.rows[0]);
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

    const txRes = await query(
      `SELECT ct.* FROM cash_transactions ct WHERE ct.id = $1 AND ct.company_id = $2`,
      [id, auth.companyId]
    );

    if (txRes.rows.length === 0) {
      return notFound();
    }

    const existing = txRes.rows[0];

    await transaction(async (client) => {
      const updates: string[] = [];
      const updateParams: any[] = [];
      let paramIdx = 1;

      if (body.date !== undefined) {
        updates.push(`date = $${paramIdx++}`);
        updateParams.push(body.date);
      }
      if (body.type !== undefined) {
        updates.push(`type = $${paramIdx++}`);
        updateParams.push(body.type);
      }
      if (body.amount !== undefined) {
        updates.push(`amount = $${paramIdx++}`);
        updateParams.push(body.amount);
      }
      if (body.account_id !== undefined) {
        updates.push(`account_id = $${paramIdx++}`);
        updateParams.push(body.account_id);
      }
      if (body.bank_safe_id !== undefined) {
        updates.push(`bank_safe_id = $${paramIdx++}`);
        updateParams.push(body.bank_safe_id);
      }
      if (body.contact_id !== undefined) {
        updates.push(`contact_id = $${paramIdx++}`);
        updateParams.push(body.contact_id);
      }
      if (body.project_id !== undefined) {
        updates.push(`project_id = $${paramIdx++}`);
        updateParams.push(body.project_id);
      }
      if (body.category_id !== undefined) {
        updates.push(`category_id = $${paramIdx++}`);
        updateParams.push(body.category_id);
      }
      if (body.reason !== undefined) {
        updates.push(`reason = $${paramIdx++}`);
        updateParams.push(body.reason);
      }

      if (updates.length > 0) {
        updateParams.push(id);
        await client.query(
          `UPDATE cash_transactions SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          updateParams
        );
      }

      const auditId = generateId();
      await client.query(
        `INSERT INTO audit_log (id, company_id, user_id, action, entity_type, entity_id, old_values, new_values, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          auditId, auth.companyId, auth.userId, 'update', 'cash_transaction', id,
          JSON.stringify(existing), JSON.stringify(body)
        ]
      );
    });

    const updated = await query(
      `SELECT ct.*, je.sequence_number AS journal_entry_number
       FROM cash_transactions ct
       LEFT JOIN journal_entries je ON je.id = ct.journal_entry_id
       WHERE ct.id = $1`,
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

    const txRes = await query(
      `SELECT ct.* FROM cash_transactions ct WHERE ct.id = $1 AND ct.company_id = $2`,
      [id, auth.companyId]
    );

    if (txRes.rows.length === 0) {
      return notFound();
    }

    const tx = txRes.rows[0];

    await transaction(async (client) => {
      if (tx.journal_entry_id) {
        await client.query(
          `DELETE FROM journal_lines WHERE journal_entry_id = $1`,
          [tx.journal_entry_id]
        );
        await client.query(
          `DELETE FROM journal_entries WHERE id = $1`,
          [tx.journal_entry_id]
        );
      }

      const auditId = generateId();
      await client.query(
        `INSERT INTO audit_log (id, company_id, user_id, action, entity_type, entity_id, old_values, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [auditId, auth.companyId, auth.userId, 'delete', 'cash_transaction', id, JSON.stringify(tx)]
      );

      await client.query(
        `DELETE FROM cash_transactions WHERE id = $1`,
        [id]
      );
    });

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
