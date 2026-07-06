import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const employeeId = url.searchParams.get('employeeId');

    const conditions = ['p.company_id = $1'];
    const params: any[] = [auth.companyId];
    let idx = 2;
    if (from) { conditions.push(`p.date >= $${idx}`); params.push(from); idx++; }
    if (to) { conditions.push(`p.date <= $${idx}`); params.push(to); idx++; }
    if (employeeId) { conditions.push(`p.employee_id = $${idx}`); params.push(employeeId); idx++; }

    const where = conditions.join(' AND ');
    const total = await query(`SELECT COUNT(*) as cnt FROM payroll p WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);

    const records = await query(
      `SELECT p.*, e.name as employee_name, e.department FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       WHERE ${where} ORDER BY p.date DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return success({ records: records.rows, total: parseInt(total.rows[0].cnt, 10), page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { date, employee_ids } = data;

    if (!auth.companyId || !date || !employee_ids || employee_ids.length === 0) {
      return error('company_id, date, employee_ids are required');
    }

    const results = await transaction(async (client) => {
      const jeDesc = `رواتب شهر ${date.substring(0, 7)}`;
      const salaryExpenseAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.SALARIES_EXPENSE]
      );
      const accruedSalaryAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.ACCRUED_SALARIES]
      );
      const advAccount = await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.EMPLOYEE_ADVANCES]
      );

      const je = await client.query(
        `INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
         VALUES ($1, (SELECT COALESCE(MAX(number),0)+1 FROM journal_entries WHERE company_id=$1),
         $2, 'general', $3, $4) RETURNING *`,
        [auth.companyId, date, jeDesc, auth.userId]
      );
      const jeId = je.rows[0].id;

      let totalSalary = 0;
      let totalAdvance = 0;
      const created: any[] = [];

      for (const empId of employee_ids) {
        const emp = await client.query(`SELECT * FROM employees WHERE id = $1`, [empId]);
        if (emp.rows.length === 0) continue;

        const salary = parseFloat(emp.rows[0].salary) || 0;
        const advResult = await client.query(
          `SELECT COALESCE(SUM(CASE WHEN type = 'advance' THEN amount ELSE 0 END), 0) -
                  COALESCE(SUM(CASE WHEN type = 'deduction' THEN amount ELSE 0 END), 0) as balance
           FROM employee_advances WHERE employee_id = $1 AND company_id = $2`,
          [empId, auth.companyId]
        );
        const advanceBalance = parseFloat(advResult.rows[0].balance) || 0;
        const advanceDeduction = Math.min(advanceBalance, salary * 0.5);
        const netPay = salary - advanceDeduction;

        const payroll = await client.query(
          `INSERT INTO payroll (company_id, employee_id, date, basic_salary, allowances, deductions, advance_deduction, net_pay, journal_entry_id)
           VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $7) RETURNING *`,
          [auth.companyId, empId, date, salary, advanceDeduction, netPay, jeId]
        );
        created.push(payroll.rows[0]);
        totalSalary += salary;

        if (advanceDeduction > 0) {
          await client.query(
            `INSERT INTO employee_advances (company_id, employee_id, date, type, amount, description)
             VALUES ($1, $2, $3, 'deduction', $4, 'تسديد سلفة من الراتب')`,
            [auth.companyId, empId, date, advanceDeduction]
          );
          totalAdvance += advanceDeduction;
        }
      }

      if (salaryExpenseAccount.rows.length > 0) {
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, 0)`,
          [jeId, salaryExpenseAccount.rows[0].id, totalSalary]
        );
      }
      if (accruedSalaryAccount.rows.length > 0) {
        const accruedAmount = totalSalary - totalAdvance;
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
          [jeId, accruedSalaryAccount.rows[0].id, accruedAmount]
        );
      }
      if (advAccount.rows.length > 0 && totalAdvance > 0) {
        await client.query(
          `INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, $3)`,
          [jeId, advAccount.rows[0].id, totalAdvance]
        );
      }

      return created;
    });

    return success(results, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
