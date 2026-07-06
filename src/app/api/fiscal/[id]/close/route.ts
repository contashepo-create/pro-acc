import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;

    const result = await transaction(async (client) => {
      const fy = await client.query(`SELECT * FROM fiscal_years WHERE id = $1 FOR UPDATE`, [id]);
      if (fy.rows.length === 0) throw new Error('Not found');
      if (fy.rows[0].status === 'closed') throw new Error('السنة المالية مقفلة بالفعل');

      const companyId = fy.rows[0].company_id;
      const endDate = fy.rows[0].end_date;

      // Verify the fiscal year belongs to the authed company
      if (companyId !== auth.companyId) throw new Error('غير مصرح به');

      const openCustodies = await client.query(
        `SELECT id FROM custodies WHERE company_id = $1 AND status = 'open' LIMIT 1`,
        [companyId]
      );
      if (openCustodies.rows.length > 0) throw new Error('لا يمكن إقفال السنة والعُهد مفتوحة');

      const unposted = await client.query(
        `SELECT id FROM journal_entries WHERE company_id = $1 AND date <= $2 AND type != 'closing' AND (reversal_of IS NULL) LIMIT 1`,
        [companyId, endDate]
      );

      const openAdvances = await client.query(
        `SELECT ea.id FROM employee_advances ea
         JOIN employees e ON ea.employee_id = e.id
         WHERE e.company_id = $1 AND ea.type = 'advance'
         AND (ea.id NOT IN (SELECT reference_id FROM journal_lines WHERE account_id IN
           (SELECT id FROM accounts WHERE code = $2))) LIMIT 1`,
        [companyId, ACCOUNT_CODES.EMPLOYEE_ADVANCES]
      );

      const warnings: string[] = [];
      const subcontractorDue = await client.query(
        `SELECT id FROM subcon_certificates WHERE status = 'approved' AND paid_amount < net_amount LIMIT 1`,
        []
      );
      if (subcontractorDue.rows.length > 0) warnings.push('هناك شهادات مقاولي باطن غير مدفوعة');

      const activeProjects = await client.query(
        `SELECT id FROM projects WHERE company_id = $1 AND status = 'active' LIMIT 1`,
        [companyId]
      );
      if (activeProjects.rows.length > 0) warnings.push('هناك مشاريع نشطة');

      const revenueAccounts = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND type = 'revenue'`,
        [companyId]
      );
      const expenseAccounts = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND type = 'expense'`,
        [companyId]
      );

      let totalRevenue = 0;
      for (const acc of revenueAccounts.rows) {
        const res = await client.query(
          `SELECT COALESCE(SUM(credit) - SUM(debit), 0) as balance FROM journal_lines
           WHERE account_id = $1 AND journal_entry_id IN
           (SELECT id FROM journal_entries WHERE company_id = $2 AND date <= $3 AND type != 'closing')`,
          [acc.id, companyId, endDate]
        );
        totalRevenue += parseFloat(res.rows[0].balance) || 0;
      }

      let totalExpenses = 0;
      for (const acc of expenseAccounts.rows) {
        const res = await client.query(
          `SELECT COALESCE(SUM(debit) - SUM(credit), 0) as balance FROM journal_lines
           WHERE account_id = $1 AND journal_entry_id IN
           (SELECT id FROM journal_entries WHERE company_id = $2 AND date <= $3 AND type != 'closing')`,
          [acc.id, companyId, endDate]
        );
        totalExpenses += parseFloat(res.rows[0].balance) || 0;
      }

      const netIncome = totalRevenue - totalExpenses;
      const retainedAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [companyId, ACCOUNT_CODES.RETAINED_EARNINGS]
      );

      if (netIncome !== 0 && retainedAccount.rows.length > 0) {
        const closingJe = await client.query(
          `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
           VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
           $2, 'closing', 'قيد إقفال السنة المالية', $3) RETURNING *`,
          [companyId, endDate, auth.userId]
        );
        const jeId = closingJe.rows[0].id;

        if (netIncome > 0) {
          for (const acc of revenueAccounts.rows) {
            const res = await client.query(
              `SELECT COALESCE(SUM(credit) - SUM(debit), 0) as balance FROM journal_lines
               WHERE account_id = $1 AND journal_entry_id IN
               (SELECT id FROM journal_entries WHERE company_id = $2 AND date <= $3 AND type != 'closing')`,
              [acc.id, companyId, endDate]
            );
            const bal = parseFloat(res.rows[0].balance) || 0;
            if (bal > 0) {
              await client.query(
                `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
                [jeId, acc.id, bal]
              );
            }
          }
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
            [jeId, retainedAccount.rows[0].id, netIncome]
          );
        } else {
          const loss = Math.abs(netIncome);
          for (const acc of expenseAccounts.rows) {
            const res = await client.query(
              `SELECT COALESCE(SUM(debit) - SUM(credit), 0) as balance FROM journal_lines
               WHERE account_id = $1 AND journal_entry_id IN
               (SELECT id FROM journal_entries WHERE company_id = $2 AND date <= $3 AND type != 'closing')`,
              [acc.id, companyId, endDate]
            );
            const bal = parseFloat(res.rows[0].balance) || 0;
            if (bal > 0) {
              await client.query(
                `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
                [jeId, acc.id, bal]
              );
            }
          }
          await client.query(
            `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
            [jeId, retainedAccount.rows[0].id, loss]
          );
        }
      }

      await client.query(
        `UPDATE fiscal_years SET status = 'closed', closed_at = NOW(), closed_by = $1 WHERE id = $2`,
        [auth.userId, id]
      );

      return { ...fy.rows[0], status: 'closed', warnings };
    });

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
