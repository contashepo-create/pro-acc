import { NextRequest } from 'next/server';
import { success, unauthorized, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/admin-auth';

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const res = await query(
      `SELECT id, action, details, created_at
       FROM admin_audit_log
       WHERE target_type = 'user' AND target_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [id]
    );

    return success(res.rows.map((row: any) => ({
      action: row.action,
      details: row.details || '',
      timestamp: new Date(row.created_at).toLocaleString('ar-SA'),
    })));
  } catch (err) {
    return serverError(err);
  }
}
