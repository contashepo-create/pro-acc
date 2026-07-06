import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';
import { formatDate } from '@/lib/utils';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const total = await query(`SELECT COUNT(*) as cnt FROM fixed_assets WHERE company_id = $1`, [auth.companyId]);
    const offset = (page - 1) * pageSize;

    const assets = await query(
      `SELECT f.*,
        (f.purchase_cost - f.accumulated_depreciation) as net_book_value
       FROM fixed_assets f
       WHERE f.company_id = $1 ORDER BY f.purchase_date DESC LIMIT $2 OFFSET $3`,
      [auth.companyId, pageSize, offset]
    );

    return success({ assets: assets.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { name, code, category, purchase_date, purchase_cost, useful_life_years, depreciation_method, location, notes } = data;

    if (!auth.companyId || !name || !code || !category || !purchase_date || !purchase_cost || !useful_life_years) {
      return error('company_id, name, code, category, purchase_date, purchase_cost, useful_life_years are required');
    }

    const result = await transaction(async (client) => {
      const rate = depreciation_method === 'declining_balance' ? (2 / useful_life_years) : (1 / useful_life_years);

      const asset = await client.query(
        `INSERT INTO fixed_assets (company_id, name, code, category, purchase_date, purchase_cost,
          useful_life_years, depreciation_rate, depreciation_method, accumulated_depreciation, status, location, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 'active', $10, $11) RETURNING *`,
        [auth.companyId, name, code, category, purchase_date, purchase_cost,
         useful_life_years, rate, depreciation_method || 'straight_line', location || null, notes || null]
      );

      const assetAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.FIXED_ASSETS_START]
      );
      const bankAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.BANKS]
      );

      if (assetAccount.rows.length > 0) {
        const je = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
           VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
           $2, 'general', $3, $4) RETURNING *`,
          [auth.companyId, purchase_date, `شراء أصل ثابت: ${name}`, auth.userId]
        );

        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
          [je.rows[0].id, assetAccount.rows[0].id, purchase_cost]
        );
        if (bankAccount.rows.length > 0) {
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
            [je.rows[0].id, bankAccount.rows[0].id, purchase_cost]
          );
        }
      }

      return asset.rows[0];
    });

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
