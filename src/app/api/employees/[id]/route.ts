import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, notFound, requireApiAuth } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const result = await query(`SELECT * FROM employees WHERE id = $1 AND company_id = $2`, [id, auth.companyId]);
    if (result.rows.length === 0) return notFound();
    return success(result.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const data = await parseBody(req);

    const result = await query(
      `UPDATE employees SET name = COALESCE($1, name), phone = $2, email = $3,
       salary = COALESCE($4, salary), department = $5, position = $6,
       hire_date = COALESCE($7, hire_date), is_active = COALESCE($8, is_active), updated_at = NOW()
       WHERE id = $9 AND company_id = $10 RETURNING *`,
      [data.name, data.phone ?? null, data.email ?? null, data.salary, data.department ?? null,
       data.position ?? null, data.hire_date, data.is_active, id, auth.companyId]
    );
    if (result.rows.length === 0) return notFound();
    return success(result.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const deps = await query(
      `SELECT (SELECT COUNT(*) FROM payroll WHERE employee_id = $1) +
              (SELECT COUNT(*) FROM voucher_disbursements WHERE employee_id = $1) +
              (SELECT COUNT(*) FROM employee_advances WHERE employee_id = $1) as cnt`,
      [id]
    );
    if (parseInt(deps.rows[0].cnt, 10) > 0) return error('لا يمكن حذف موظف لديه سجلات مرتبطة');

    await query(`DELETE FROM employees WHERE id = $1`, [id]);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
