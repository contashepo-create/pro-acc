import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

async function getCompanyId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const res = await query('SELECT company_id FROM users WHERE id = $1 AND is_active = true', [payload.userId]);
  return res.rows.length > 0 ? res.rows[0].company_id : null;
}

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const companyId = await getCompanyId(request);
    if (!companyId) return unauthorized();

    const entryRes = await query(
      `SELECT id, company_id, number, date, type, description, reference, created_by, created_at
       FROM journal_entries
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (entryRes.rows.length === 0) return notFound();

    const linesRes = await query(
      `SELECT jl.id, jl.account_code, a.name as account_name, a.type as account_type,
              jl.debit, jl.credit, jl.description
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE jl.journal_entry_id = $1
       ORDER BY jl.id`,
      [id]
    );

    const totalDebit = linesRes.rows.reduce((s: number, l: any) => s + l.debit, 0);
    const totalCredit = linesRes.rows.reduce((s: number, l: any) => s + l.credit, 0);

    return success({
      ...entryRes.rows[0],
      totalDebit,
      totalCredit,
      lines: linesRes.rows,
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const companyId = await getCompanyId(request);
    if (!companyId) return unauthorized();

    const entryRes = await query(
      `SELECT id, number, date, type FROM journal_entries
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (entryRes.rows.length === 0) return notFound();

    const reversalRes = await query(
      `SELECT id FROM journal_entries
       WHERE reference = $1 AND company_id = $2
       LIMIT 1`,
      [id, companyId]
    );

    if (reversalRes.rows.length > 0) {
      return error('لا يمكن حذف قيد له قيود عكسية. قم بحذف القيود العكسية أولاً');
    }

    await query('DELETE FROM journal_lines WHERE journal_entry_id = $1', [id]);
    await query('DELETE FROM journal_entries WHERE id = $1', [id]);

    return success({ message: 'تم حذف القيد بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
