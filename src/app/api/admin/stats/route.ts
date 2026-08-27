import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success } from '@/lib/api-helpers';

const sb = () => getSupabase();

// Known tables in the database
const KNOWN_TABLES = [
  'activation_codes', 'admin_audit_log', 'admin_users', 'advertisements',
  'companies', 'complaints', 'messages', 'payment_transactions',
  'subscription_plans', 'subscriptions', 'users',
];

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const s = sb();

    const [companiesRes, usersRes, activeUsersRes, adminUsersRes] = await Promise.all([
      s.from('companies').select('id', { count: 'exact', head: true }),
      s.from('users').select('id', { count: 'exact', head: true }),
      s.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true),
      s.from('admin_users').select('id', { count: 'exact', head: true }),
    ]);
    for (const result of [companiesRes, usersRes, activeUsersRes, adminUsersRes]) {
      if (result.error) throw result.error;
    }

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
    return adminJsonError(err);
  }
}
