import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { accountSchema } from '@/lib/validation';

async function getCompanyId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const res = await query('SELECT company_id FROM users WHERE id = $1 AND is_active = true', [payload.userId]);
  return res.rows.length > 0 ? res.rows[0].company_id : null;
}

export async function GET(request: NextRequest) {
  try {
    const companyId = await getCompanyId(request);
    if (!companyId) return unauthorized();

    const res = await query(
      `SELECT id, code, name, name_en, type, parent_id, is_active, currency, created_at
       FROM accounts
       WHERE company_id = $1
       ORDER BY code`,
      [companyId]
    );

    const accounts = res.rows.map(a => ({
      ...a,
      children: [] as any[],
    }));

    const accountMap = new Map(accounts.map(a => [a.id, a]));
    const roots: typeof accounts = [];

    for (const acc of accounts) {
      if (acc.parent_id && accountMap.has(acc.parent_id)) {
        accountMap.get(acc.parent_id)!.children.push(acc);
      } else {
        roots.push(acc);
      }
    }

    return success({ accounts: roots });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const companyId = await getCompanyId(request);
    if (!companyId) return unauthorized();

    const body = await parseBody(request);
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) {
      return error(parsed.error.issues[0].message);
    }

    const { code, name, nameEn, type, parentId, isActive, currency } = parsed.data;

    const depthLimit = 10;
    if (parentId) {
      const parentRes = await query(
        `SELECT id FROM accounts WHERE id = $1 AND company_id = $2`,
        [parentId, companyId]
      );
      if (parentRes.rows.length === 0) {
        return error('الحساب الأب غير موجود');
      }

      let depth = 1;
      let currentParent = parentId;
      while (currentParent) {
        const pRes = await query(
          `SELECT parent_id FROM accounts WHERE id = $1 AND company_id = $2`,
          [currentParent, companyId]
        );
        if (pRes.rows.length === 0) break;
        currentParent = pRes.rows[0].parent_id;
        depth++;
        if (depth > depthLimit) {
          return error(`لا يمكن تجاوز ${depthLimit} مستويات في شجرة الحسابات`);
        }
      }
    }

    const existing = await query(
      `SELECT id FROM accounts WHERE company_id = $1 AND code = $2`,
      [companyId, code]
    );
    if (existing.rows.length > 0) {
      return error('رمز الحساب موجود مسبقاً');
    }

    const created = await query(
      `INSERT INTO accounts (company_id, code, name, name_en, type, parent_id, is_active, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, code, name, name_en, type, parent_id, is_active, currency, created_at`,
      [companyId, code, name, nameEn || null, type, parentId || null, isActive ?? true, currency || null]
    );

    return success(created.rows[0], 201);
  } catch (err) {
    return serverError(err);
  }
}
