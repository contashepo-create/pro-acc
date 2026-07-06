import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound, parseBody } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
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

    const res = await query(
      `SELECT id, code, name, name_en, type, parent_id, is_active, currency, created_at
       FROM accounts
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (res.rows.length === 0) return notFound();

    const children = await query(
      `SELECT id, code, name, type, parent_id, is_active
       FROM accounts
       WHERE parent_id = $1 AND company_id = $2
       ORDER BY code`,
      [id, companyId]
    );

    return success({ ...res.rows[0], children: children.rows });
  } catch (err) {
    return serverError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const companyId = await getCompanyId(request);
    if (!companyId) return unauthorized();

    const body = await parseBody<{ code?: string; name?: string; is_active?: boolean }>(request);

    const existing = await query(
      `SELECT id FROM accounts WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    if (existing.rows.length === 0) return notFound();

    if (body.code) {
      if (!/^\d{4}$/.test(body.code)) {
        return error('رمز الحساب يجب أن يكون 4 أرقام');
      }
      const dup = await query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 AND id != $3`,
        [companyId, body.code, id]
      );
      if (dup.rows.length > 0) {
        return error('رمز الحساب موجود مسبقاً لحساب آخر');
      }
    }

    await query(
      `UPDATE accounts
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           is_active = COALESCE($3, is_active),
           updated_at = NOW()::timestamp
       WHERE id = $4 AND company_id = $5`,
      [body.code || null, body.name || null, body.is_active ?? null, id, companyId]
    );

    const updated = await query(
      `SELECT id, code, name, name_en, type, parent_id, is_active, currency, created_at
       FROM accounts WHERE id = $1`,
      [id]
    );

    return success(updated.rows[0]);
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

    const existing = await query(
      `SELECT id, code, name FROM accounts WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    if (existing.rows.length === 0) return notFound();

    const children = await query(
      `SELECT id FROM accounts WHERE parent_id = $1 AND company_id = $2 LIMIT 1`,
      [id, companyId]
    );
    if (children.rows.length > 0) {
      return error('لا يمكن حذف حساب له حسابات فرعية. قم بنقل أو حذف الحسابات الفرعية أولاً');
    }

    const lines = await query(
      `SELECT id FROM journal_lines WHERE account_code = $1
       AND journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id = $2)
       LIMIT 1`,
      [existing.rows[0].code, companyId]
    );
    if (lines.rows.length > 0) {
      return error('لا يمكن حذف حساب له قيود محاسبية. قم بإلغاء تنشيط الحساب بدلاً من حذفه');
    }

    await query(
      `DELETE FROM accounts WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    return success({ message: 'تم حذف الحساب بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
