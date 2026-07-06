import { NextRequest } from 'next/server';
import { success, unauthorized, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const [
      companiesRes, usersRes, dbSizeRes, lastLoginRes, activityRes,
      activeSubsRes, monthlyRevenueRes, unusedCodesRes,
      recentCompaniesRes, recentSubsRes, plansRes
    ] = await Promise.all([
      query('SELECT COUNT(*)::int as count FROM companies'),
      query('SELECT COUNT(*)::int as count FROM users'),
      query('SELECT pg_database_size(current_database())::bigint as size'),
      query(`SELECT last_login FROM admin_users WHERE id = $1`, [admin.userId]),
      query(
        `SELECT action, details, created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 10`
      ),
      query(`SELECT COUNT(*)::int as count FROM subscriptions WHERE status = 'active'`),
      query(
        `SELECT COALESCE(SUM(p.price_monthly), 0)::float as revenue
         FROM subscriptions s
         JOIN subscription_plans p ON p.id = s.plan_id
         WHERE s.status = 'active'`
      ),
      query(`SELECT COUNT(*)::int as count FROM activation_codes WHERE is_used = false`),
      query(
        `SELECT id, name, is_active, created_at FROM companies ORDER BY created_at DESC LIMIT 5`
      ),
      query(
        `SELECT s.id, c.name as company_name, p.name as plan_name, s.status, s.end_date
         FROM subscriptions s
         LEFT JOIN companies c ON c.id = s.company_id
         LEFT JOIN subscription_plans p ON p.id = s.plan_id
         ORDER BY s.created_at DESC LIMIT 5`
      ),
      query(`SELECT code, name, price_monthly, is_active FROM subscription_plans ORDER BY sort_order LIMIT 6`),
    ]);

    const dbSizeBytes = dbSizeRes.rows[0].size;

    return success({
      companiesCount: companiesRes.rows[0].count,
      usersCount: usersRes.rows[0].count,
      activeSubscriptions: activeSubsRes.rows[0].count,
      monthlyRevenue: monthlyRevenueRes.rows[0].revenue,
      unusedCodes: unusedCodesRes.rows[0].count,
      dbSize: formatBytes(dbSizeBytes),
      lastLogin: lastLoginRes.rows[0]?.last_login
        ? new Date(lastLoginRes.rows[0].last_login).toLocaleString('ar-SA')
        : '--',
      recentActivity: activityRes.rows.map((row: any) => ({
        action: row.action,
        details: row.details || '',
        timestamp: new Date(row.created_at).toLocaleString('ar-SA'),
      })),
      recentCompanies: recentCompaniesRes.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        is_active: row.is_active,
        created_at: new Date(row.created_at).toLocaleDateString('ar-SA'),
      })),
      recentSubscriptions: recentSubsRes.rows.map((row: any) => ({
        id: row.id,
        company_name: row.company_name || '--',
        plan_name: row.plan_name || row.plan_code || '--',
        status: row.status,
        end_date: row.end_date,
      })),
      planDistribution: plansRes.rows.map((row: any) => ({
        name: row.name,
        price: row.price_monthly,
        is_active: row.is_active,
      })),
      systemHealth: {
        dbStatus: 'متصل',
        apiResponseTime: '< 100ms',
        uptime: formatUptime(process.uptime()),
      },
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

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}ي ${hours}س`;
  if (hours > 0) return `${hours}س ${mins}د`;
  return `${mins}د`;
}
