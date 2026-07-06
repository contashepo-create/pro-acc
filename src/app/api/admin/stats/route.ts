import { NextRequest } from 'next/server';
import { success, unauthorized, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const companiesRes = await query('SELECT COUNT(*)::int as count FROM companies');
    const usersRes = await query('SELECT COUNT(*)::int as count FROM users');
    const activeUsersRes = await query("SELECT COUNT(*)::int as count FROM users WHERE is_active = true");
    const adminUsersRes = await query('SELECT COUNT(*)::int as count FROM admin_users');

    const tablesRes = await query(
      `SELECT COUNT(*)::int as count
       FROM information_schema.tables
       WHERE table_schema = 'public'`
    );

    const dbSizeRes = await query(
      `SELECT pg_database_size(current_database())::bigint as size`
    );

    return success({
      companies: companiesRes.rows[0].count,
      users: usersRes.rows[0].count,
      activeUsers: activeUsersRes.rows[0].count,
      adminUsers: adminUsersRes.rows[0].count,
      tables: tablesRes.rows[0].count,
      dbSizeBytes: dbSizeRes.rows[0].size,
      dbSizeFormatted: formatBytes(dbSizeRes.rows[0].size),
    });
  } catch (err) {
    return serverError(err);
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
