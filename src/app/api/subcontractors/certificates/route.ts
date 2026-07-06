import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const contractId = url.searchParams.get('contractId');

    const conditions = ['cc.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (contractId) { conditions.push(`cc.contract_id = $${idx}`); params.push(contractId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM subcon_certificates cc WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const certs = await query(
      `SELECT cc.*, sc.contract_number, c.name as subcontractor_name
       FROM subcon_certificates cc
       JOIN subcontractor_contracts sc ON cc.contract_id = sc.id
       JOIN contacts c ON sc.subcontractor_id = c.id
       WHERE ${where} ORDER BY cc.date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ certificates: certs.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { contract_id, date, certificate_number, description, gross_amount, retention_rate } = data;

    if (!auth.companyId || !contract_id || !date || !certificate_number || !gross_amount) {
      return error('company_id, contract_id, date, certificate_number, gross_amount are required');
    }

    const result = await transaction(async (client) => {
      const contract = await client.query(
        `SELECT * FROM subcontractor_contracts WHERE id = $1`, [contract_id]
      );
      if (contract.rows.length === 0) throw new Error('العقد غير موجود');

      const rate = retention_rate ?? contract.rows[0].retention_rate ?? 0;
      const retentionAmount = gross_amount * rate;
      const netAmount = gross_amount - retentionAmount;

      const cert = await client.query(
        `INSERT INTO subcon_certificates (company_id, contract_id, date, certificate_number, description,
          gross_amount, retention_rate, retention_amount, net_amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved') RETURNING *`,
        [auth.companyId, contract_id, date, certificate_number, description || null,
         gross_amount, rate, retentionAmount, netAmount]
      );

      const costAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.DIRECT_COSTS]
      );
      const apAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES]
      );
      const retentionAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.RETENTIONS]
      );

      if (costAccount.rows.length > 0 && apAccount.rows.length > 0) {
        const lines: any[] = [
          { account_id: costAccount.rows[0].id, debit: gross_amount, credit: 0 },
          { account_id: apAccount.rows[0].id, debit: 0, credit: netAmount },
        ];
        if (retentionAmount > 0 && retentionAccount.rows.length > 0) {
          lines.push({ account_id: retentionAccount.rows[0].id, debit: 0, credit: retentionAmount });
        }

        const je = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, reference_type, reference_id, created_by)
           VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
           $2, 'general', $3, 'subcon_certificate', $4, $5) RETURNING *`,
          [auth.companyId, date, `شهادة مقاول باطن: ${certificate_number}`, cert.rows[0].id, auth.userId]
        );

        for (const line of lines) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)`,
            [je.rows[0].id, line.account_id, line.debit, line.credit]
          );
        }
      }

      return cert.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
