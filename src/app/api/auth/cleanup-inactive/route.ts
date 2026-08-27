import { NextRequest } from 'next/server';
import { success, error, serverError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

// GET /api/auth/cleanup-inactive — called by Vercel Cron daily at 3am
// POST /api/auth/cleanup-inactive — called manually with x-cron-secret header
// Deactivates expired trial accounts inactive for 15+ days; never hard-deletes ledgers

async function doCleanup() {
  // Financial and tax records are retained. Eligible expired tenants are
  // deactivated atomically instead of being partially hard-deleted table by
  // table. Reactivation remains possible after an administrative review.
  const cutoff = new Date(Date.now() - 15 * 86400000).toISOString();
  const { data, error: cleanupError } = await sb().rpc('deactivate_inactive_expired_companies', {
    p_cutoff: cutoff,
  });
  if (cleanupError) throw cleanupError;
  const result = data as Record<string, number> | null;
  return success({
    message: 'تم تعطيل الحسابات المنتهية وغير النشطة مع الاحتفاظ بسجلاتها المالية',
    deactivatedCompanies: Number(result?.deactivated_companies || 0),
    deactivatedUsers: Number(result?.deactivated_users || 0),
  });
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = authHeader.replace('Bearer ', '') || request.headers.get('x-cron-secret');
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return error('CRON_SECRET غير مضبوط — العملية مرفوضة', 401);
    }
    if (!cronSecret || cronSecret.length !== expected.length) {
      return error('غير مصرح', 401);
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return error('غير مصرح', 401);

    return await doCleanup();
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret');
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return error('CRON_SECRET غير مضبوط — العملية مرفوضة', 401);
    }
    if (!cronSecret || cronSecret.length !== expected.length) {
      return error('غير مصرح', 401);
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return error('غير مصرح', 401);

    return await doCleanup();
  } catch (err) {
    return serverError(err);
  }
}
