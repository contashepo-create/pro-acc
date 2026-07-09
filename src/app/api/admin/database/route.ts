import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

// @ts-ignore
const sb = () => getSupabase() as any;

// Known tables in the database
const KNOWN_TABLES = [
  'activation_codes', 'admin_audit_log', 'admin_users', 'advertisements',
  'companies', 'complaints', 'messages', 'payment_transactions',
  'subscription_plans', 'subscriptions', 'users',
];

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const s = sb();

    // Query each known table for row count
    const tableInfos = await Promise.all(
      KNOWN_TABLES.map(async (tableName) => {
        const { count } = await s.from(tableName).select('*', { count: 'exact', head: true });
        return {
          name: tableName,
          row_count: count || 0,
          size: 'N/A',
        };
      })
    );

    // Calculate total rows
    const totalRows = tableInfos.reduce((sum, t) => sum + t.row_count, 0);

    return success({
      dbSize: formatBytes(totalRows * 1024), // rough estimate
      dbPath: 'Supabase',
      healthStatus: 'good',
      tables: tableInfos,
      indexHealth: {
        total: 0,
        missing: 0,
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
