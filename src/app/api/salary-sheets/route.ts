import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const result = await query(
      'SELECT * FROM salary_sheets WHERE company_id = $1 ORDER BY year DESC, month DESC',
      [auth.companyId]
    );
    return success(result.rows);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const { name, month, year, date, items } = await parseBody(req);
    if (!auth.companyId || !name || !month || !year) {
      return error('companyId, name, month, year are required');
    }

    const sheet = await query(
      `INSERT INTO salary_sheets (company_id, name, month, year, date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [auth.companyId, name, month, year, date ?? new Date().toISOString().split('T')[0]]
    );

    if (items && items.length > 0) {
      for (const item of items) {
        await query(
          `INSERT INTO salary_items (company_id, sheet_id, employee_id, basic_salary, allowances, deductions, net_pay)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [auth.companyId, sheet.rows[0].id, item.employeeId, item.basicSalary ?? 0, item.allowances ?? 0, item.deductions ?? 0, item.netPay ?? 0]
        );
      }
    }

    return success(sheet.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}
