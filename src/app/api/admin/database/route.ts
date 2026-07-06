import { NextRequest } from 'next/server';
import { success, unauthorized, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const dbSizeRes = await query(
      `SELECT pg_database_size(current_database())::bigint as size`
    );
    const dbSizeBytes = dbSizeRes.rows[0].size;

    const tablesRes = await query(
      `SELECT schemaname, relname as name, n_live_tup as row_count,
              pg_size_pretty(pg_total_relation_size(relid)) as size
       FROM pg_stat_user_tables
       WHERE schemaname = 'public'
       ORDER BY pg_total_relation_size(relid) DESC`
    );

    const indexRes = await query(
      `SELECT COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE idx_scan = 0) as unused
       FROM pg_stat_user_indexes`
    );

    return success({
      dbSize: formatBytes(dbSizeBytes),
      dbPath: 'PostgreSQL',
      healthStatus: indexRes.rows[0].unused > 5 ? 'warning' : 'good',
      tables: tablesRes.rows.map((t: any) => ({
        name: t.name,
        row_count: parseInt(t.row_count) || 0,
        size: t.size,
      })),
      indexHealth: {
        total: indexRes.rows[0].total,
        missing: indexRes.rows[0].unused,
        issues: [],
      },
      slowQueries: [],
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
