import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

// GET /api/auth/cleanup-inactive — called by Vercel Cron daily at 3am
// POST /api/auth/cleanup-inactive — called manually with x-cron-secret header
// Deletes free/trial accounts inactive for 15+ days

async function doCleanup() {
  const s = sb();
  const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString();

  // Get subscriptions matching criteria
  const { data: subs } = await s.from('subscriptions')
    .select('company_id')
    .in('plan_code', ['trial', 'free', 'starter'])
    .in('status', ['trial', 'expired', 'cancelled']);

  const subCompanyIds = [...new Set((subs || []).map((s: any) => s.company_id))];

  if (subCompanyIds.length === 0) {
    return success({
      message: 'تم تنظيف الحسابات غير النشطة',
      deletedCompanies: 0,
      deletedUsers: 0,
    });
  }

  // Get inactive users for those companies
  const { data: users } = await s.from('users')
    .select('company_id, last_activity, last_login')
    .in('company_id', subCompanyIds)
    .not('last_login', 'is', null);

  // Filter inactive users
  const inactiveCompanyIds = [...new Set(
    (users || [])
      .filter((u: any) => !u.last_activity || new Date(u.last_activity) < new Date(fifteenDaysAgo))
      .map((u: any) => u.company_id)
  )];

  let deletedCompanies = 0;
  let deletedUsers = 0;

  const tablesToClean = [
    'journal_lines',
    'journal_entries',
    'invoices',
    'clients',
    'contacts',
    'accounts',
    'transactions',
    'subscriptions',
    'login_attempts',
    'settings',
    'notifications',
  ];

  for (const companyId of inactiveCompanyIds) {
    // Delete from all related tables (best-effort)
    for (const table of tablesToClean) {
      await s.from(table).delete().eq('company_id', companyId).then(
        () => {},
        () => {}
      );
    }

    // Delete users and count
    const { data: deletedUserRows } = await s.from('users')
      .delete()
      .eq('company_id', companyId)
      .select('id');

    deletedUsers += (deletedUserRows || []).length;

    // Delete company
    await s.from('companies').delete().eq('id', companyId);
    deletedCompanies++;
  }

  return success({
    message: 'تم تنظيف الحسابات غير النشطة',
    deletedCompanies,
    deletedUsers,
  });
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = authHeader.replace('Bearer ', '') || request.headers.get('x-cron-secret');

    if (cronSecret !== process.env.CRON_SECRET) {
      return error('غير مصرح', 401);
    }
    return await doCleanup();
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
      return error('غير مصرح', 401);
    }
    return await doCleanup();
  } catch (err) {
    return serverError(err);
  }
}
