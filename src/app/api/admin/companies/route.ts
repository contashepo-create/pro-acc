import { NextRequest } from 'next/server';
import { success, unauthorized, serverError, getPaginationParams } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const { page, pageSize } = getPaginationParams(request.url);

    const countRes = await query('SELECT COUNT(*)::int as total FROM companies');
    const total = countRes.rows[0].total;

    const res = await query(
      `SELECT c.id, c.name, c.commercial_registration, c.tax_number,
              c.address, c.phone, c.email, c.is_active,
              c.created_at,
              (SELECT COUNT(*) FROM users WHERE company_id = c.id)::int as user_count
       FROM companies c
       ORDER BY c.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize]
    );

    return success({
      companies: res.rows,
      total,
      page,
      pageSize,
    });
  } catch (err) {
    return serverError(err);
  }
}
