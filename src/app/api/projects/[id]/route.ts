import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { generateId } from '@/lib/utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;

    const projectRes = await query(
      `SELECT p.*, c.name AS client_name
       FROM projects p
       LEFT JOIN contacts c ON c.id = p.client_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [id, auth.companyId]
    );

    if (projectRes.rows.length === 0) {
      return notFound();
    }

    const project = projectRes.rows[0];

    const costRes = await query(
      `SELECT COALESCE(SUM(jl.debit), 0) AS total_cost
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE (jl.project_id = $1 OR jl.journal_entry_id IN (
         SELECT id FROM journal_entries WHERE project_id = $1
       ))
       AND a.type = 'expense'
       AND jl.journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.company_id = $2
       )`,
      [id, auth.companyId]
    );

    const revenueRes = await query(
      `SELECT COALESCE(SUM(jl.credit), 0) AS total_revenue
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE (jl.project_id = $1 OR jl.journal_entry_id IN (
         SELECT id FROM journal_entries WHERE project_id = $1
       ))
       AND a.type = 'revenue'
       AND jl.journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.company_id = $2
       )`,
      [id, auth.companyId]
    );

    const invRes = await query(
      `SELECT id, number, total, paid_amount, status FROM invoices WHERE project_id = $1 AND company_id = $2 ORDER BY created_at DESC`,
      [id, auth.companyId]
    );

    return success({
      ...project,
      cost_summary: {
        total_cost: parseFloat(costRes.rows[0].total_cost),
        total_revenue: parseFloat(revenueRes.rows[0].total_revenue),
        net_profit: parseFloat(project.contract_value) - parseFloat(costRes.rows[0].total_cost),
      },
      invoices: invRes.rows.map((inv) => ({
        ...inv,
        total: parseFloat(inv.total),
        paid_amount: parseFloat(inv.paid_amount || '0'),
      })),
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

    const projectRes = await query(
      `SELECT p.* FROM projects p WHERE p.id = $1 AND p.company_id = $2`,
      [id, auth.companyId]
    );

    if (projectRes.rows.length === 0) {
      return notFound();
    }

    const existing = projectRes.rows[0];

    await transaction(async (client) => {
      const updates: string[] = [];
      const updateParams: any[] = [];
      let paramIdx = 1;

      if (body.name !== undefined) {
        updates.push(`name = $${paramIdx++}`);
        updateParams.push(body.name);
      }
      if (body.client_id !== undefined) {
        updates.push(`client_id = $${paramIdx++}`);
        updateParams.push(body.client_id);
      }
      if (body.contract_value !== undefined) {
        updates.push(`contract_value = $${paramIdx++}`);
        updateParams.push(body.contract_value);
      }
      if (body.start_date !== undefined) {
        updates.push(`start_date = $${paramIdx++}`);
        updateParams.push(body.start_date);
      }
      if (body.end_date !== undefined) {
        updates.push(`end_date = $${paramIdx++}`);
        updateParams.push(body.end_date);
      }
      if (body.status !== undefined) {
        updates.push(`status = $${paramIdx++}`);
        updateParams.push(body.status);
      }
      if (body.description !== undefined) {
        updates.push(`description = $${paramIdx++}`);
        updateParams.push(body.description);
      }
      if (body.location !== undefined) {
        updates.push(`location = $${paramIdx++}`);
        updateParams.push(body.location);
      }

      if (updates.length > 0) {
        updateParams.push(id);
        await client.query(
          `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          updateParams
        );
      }

      if (
        body.contract_value !== undefined &&
        parseFloat(body.contract_value) !== parseFloat(existing.contract_value)
      ) {
        const invRes = await client.query(
          `SELECT id, status, journal_entry_id FROM invoices
          WHERE project_id = $1 AND company_id = $2 AND status NOT IN ('paid', 'cancelled')
          LIMIT 1`,
          [id, auth.companyId]
        );

        if (invRes.rows.length > 0) {
          const inv = invRes.rows[0];
          const oldValue = parseFloat(existing.contract_value);
          const newValue = parseFloat(body.contract_value);
          const diff = newValue - oldValue;

          await client.query(
            `UPDATE invoices SET total = $1, subtotal = $1 WHERE id = $2`,
            [newValue, inv.id]
          );

          if (inv.journal_entry_id) {
            const arRes = await client.query(
              `SELECT account_id FROM contacts WHERE id = $1`,
              [existing.client_id]
            );
            const revRes = await client.query(
              `SELECT id FROM accounts WHERE code = '4100' AND company_id = $1 LIMIT 1`,
              [auth.companyId]
            );

            if (arRes.rows[0]?.account_id && revRes.rows.length > 0) {
              const adjJeId = generateId();
              const seqRes = await client.query(
                `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq FROM journal_entries WHERE company_id = $1`,
                [auth.companyId]
              );
              const adjSeq = seqRes.rows[0].next_seq;

              await client.query(
                `INSERT INTO journal_entries (id, company_id, sequence_number, date, type, description, project_id, created_by, created_at)
                 VALUES ($1, $2, $3, $4, 'adjustment', $5, $6, $7, NOW())`,
                [adjJeId, auth.companyId, adjSeq, body.start_date || existing.start_date,
                 `تعديل قيمة العقد للمشروع: ${existing.name}`, id, auth.userId]
              );

              if (diff > 0) {
                await client.query(
                  `INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, description, project_id)
                   VALUES ($1, $2, $3, $4, 0, $6, $7), ($8, $2, $9, 0, $10, $6, $7)`,
                  [generateId(), adjJeId, arRes.rows[0].account_id, diff,
                   `تعديل قيمة العقد (+${diff})`, id,
                   generateId(), adjJeId, revRes.rows[0].id, diff]
                );
              } else {
                const absDiff = Math.abs(diff);
                await client.query(
                  `INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, description, project_id)
                   VALUES ($1, $2, $3, 0, $4, $6, $7), ($8, $2, $9, $10, 0, $6, $7)`,
                  [generateId(), adjJeId, arRes.rows[0].account_id, absDiff,
                   `تعديل قيمة العقد (${diff})`, id,
                   generateId(), adjJeId, revRes.rows[0].id, absDiff]
                );
              }
            }
          }
        }
      }
    });

    const updated = await query(
      `SELECT p.*, c.name AS client_name
       FROM projects p
       LEFT JOIN contacts c ON c.id = p.client_id
       WHERE p.id = $1`,
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

    const projectRes = await query(
      `SELECT p.* FROM projects p WHERE p.id = $1 AND p.company_id = $2`,
      [id, auth.companyId]
    );

    if (projectRes.rows.length === 0) {
      return notFound();
    }

    const depRes = await query(
      `SELECT id FROM invoices WHERE project_id = $1 AND status NOT IN ('cancelled') LIMIT 1`,
      [id]
    );
    if (depRes.rows.length > 0) {
      return error('لا يمكن حذف المشروع لأنه مرتبط بفواتير غير ملغاة');
    }

    const jeDepRes = await query(
      `SELECT id FROM journal_entries WHERE project_id = $1 LIMIT 1`,
      [id]
    );

    await transaction(async (client) => {
      if (jeDepRes.rows.length > 0) {
        for (const je of jeDepRes.rows) {
          await client.query(`DELETE FROM journal_lines WHERE journal_entry_id = $1`, [je.id]);
          await client.query(`DELETE FROM journal_entries WHERE id = $1`, [je.id]);
        }
      }

      await client.query(`UPDATE projects SET status = 'cancelled' WHERE id = $1`, [id]);
    });

    return success({ message: 'تم إلغاء المشروع بنجاح' });
  } catch (err) {
    return handleApiError(err);
  }
}
