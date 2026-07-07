import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

// GET /api/auth/cleanup-inactive — called by Vercel Cron daily at 3am
// POST /api/auth/cleanup-inactive — called manually with x-cron-secret header
// Deletes free/trial accounts inactive for 15+ days

async function doCleanup() {
  const inactiveRes = await query(
    `SELECT DISTINCT u.company_id
     FROM users u
     JOIN subscriptions s ON s.company_id = u.company_id
     WHERE s.plan_code IN ('trial', 'free', 'starter')
       AND s.status IN ('trial', 'expired', 'cancelled')
       AND (u.last_activity IS NULL OR u.last_activity < NOW() - INTERVAL '15 days')
       AND u.last_login IS NOT NULL`
  );

  const inactiveCompanyIds = inactiveRes.rows.map((r: any) => r.company_id);
  let deletedCompanies = 0;
  let deletedUsers = 0;

  for (const companyId of inactiveCompanyIds) {
    await query('DELETE FROM journal_lines WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM journal_entries WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM invoices WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM clients WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM contacts WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM accounts WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM transactions WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM subscriptions WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM login_attempts WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM settings WHERE company_id = $1', [companyId]).catch(() => {});
    await query('DELETE FROM notifications WHERE company_id = $1', [companyId]).catch(() => {});

    const userRes = await query('DELETE FROM users WHERE company_id = $1 RETURNING id', [companyId]);
    deletedUsers += userRes.rowCount || 0;

    await query('DELETE FROM companies WHERE id = $1', [companyId]);
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
    // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
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
