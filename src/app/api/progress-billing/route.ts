import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('projectId');

    const conditions = ['pb.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (projectId) { conditions.push(`pb.project_id = $${idx}`); params.push(projectId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM progress_billing pb WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const claims = await query(
      `SELECT pb.*, p.name as project_name FROM progress_billing pb
       JOIN projects p ON pb.project_id = p.id
       WHERE ${where} ORDER BY pb.date DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ claims: claims.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { project_id, date, claim_number, description, gross_amount, retention_rate } = data;

    if (!project_id || !date || !claim_number || !gross_amount) {
      return error('company_id, project_id, date, claim_number, gross_amount are required');
    }

    const result = await transaction(async (client) => {
      const rate = retention_rate || 0;
      const retentionAmount = gross_amount * rate;
      const netAmount = gross_amount - retentionAmount;

      const claim = await client.query(
        `INSERT INTO progress_billing (company_id, project_id, date, claim_number, description,
          gross_amount, retention_rate, retention_amount, net_amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved') RETURNING *`,
        [auth.companyId, project_id, date, claim_number, description || null,
         gross_amount, rate, retentionAmount, netAmount]
      );

      const arAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.ACCRUED_REVENUE]
      );
      const revenueAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.CONTRACT_REVENUE]
      );
      const retentionAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.RETENTIONS]
      );

      if (arAccount.rows.length > 0 && revenueAccount.rows.length > 0) {
        const je = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, reference_type, reference_id, created_by)
           VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
           $2, 'general', $3, 'progress_billing', $4, $5) RETURNING *`,
          [auth.companyId, date, `فاتورة مرحلية: ${claim_number}`, claim.rows[0].id, auth.userId]
        );

        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
          [je.rows[0].id, arAccount.rows[0].id, gross_amount]
        );
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
          [je.rows[0].id, revenueAccount.rows[0].id, netAmount]
        );
        if (retentionAmount > 0 && retentionAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
            [je.rows[0].id, retentionAccount.rows[0].id, retentionAmount]
          );
        }
      }

      return claim.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
