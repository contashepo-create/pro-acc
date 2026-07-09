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

    const [companiesRes, usersRes, activeUsersRes, adminUsersRes] = await Promise.all([
      s.from('companies').select('*', { count: 'exact', head: true }),
      s.from('users').select('*', { count: 'exact', head: true }),
      s.from('users').select('*', { count: 'exact', head: true }).eq('is_active', true),
      s.from('admin_users').select('*', { count: 'exact', head: true }),
    ]);

    return success({
      companies: companiesRes.count || 0,
      users: usersRes.count || 0,
      activeUsers: activeUsersRes.count || 0,
      adminUsers: adminUsersRes.count || 0,
      tables: KNOWN_TABLES.length,
      dbSizeBytes: 0,
      dbSizeFormatted: 'N/A',
    });
  } catch (err) {
    return serverError(err);
  }
}
