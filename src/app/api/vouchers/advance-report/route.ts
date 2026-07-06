import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);

    const advAccRes = await query(
      `SELECT id FROM accounts WHERE code = '2180' AND company_id = $1 LIMIT 1`,
      [auth.companyId]
    );

    if (advAccRes.rows.length === 0) {
      return success([]);
    }

    const advAccountId = advAccRes.rows[0].id;

    const reportRes = await query(
      `SELECT jl.contact_id, c.name AS contact_name,
              COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) AS balance
       FROM journal_lines jl
       LEFT JOIN contacts c ON c.id = jl.contact_id
       WHERE jl.account_id = $1
         AND jl.contact_id IS NOT NULL
         AND jl.journal_entry_id IN (
           SELECT je.id FROM journal_entries je WHERE je.company_id = $2
         )
       GROUP BY jl.contact_id, c.name
       HAVING COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) > 0.01
       ORDER BY c.name`,
      [advAccountId, auth.companyId]
    );

    return success(
      reportRes.rows.map((r) => ({
        contact_id: r.contact_id,
        contact_name: r.contact_name || '',
        balance: parseFloat(r.balance),
      }))
    );
  } catch (err) {
    return handleApiError(err);
  }
}
