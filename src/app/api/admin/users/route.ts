import { NextRequest } from 'next/server';
import { success, unauthorized, serverError, getPaginationParams } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const { page, pageSize } = getPaginationParams(request.url);
    const companyId = request.nextUrl.searchParams.get('company_id');

    let whereClause = '';
    const params: any[] = [];
    let paramIdx = 1;

    if (companyId) {
      whereClause = `WHERE u.company_id = $${paramIdx}`;
      params.push(companyId);
      paramIdx++;
    }

    const countRes = await query(
      `SELECT COUNT(*)::int as total FROM users u ${whereClause}`,
      params
    );
    const total = countRes.rows[0].total;

    params.push(pageSize, (page - 1) * pageSize);

    const res = await query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.last_login,
              u.created_at, u.company_id,
              c.name as company_name
       FROM users u
       JOIN companies c ON c.id = u.company_id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    return success({
      users: res.rows,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    return serverError(err);
  }
}
