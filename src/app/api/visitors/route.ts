import { NextRequest } from 'next/server';
import { success, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || '';
    const { path } = await request.json().catch(() => ({ path: '/' }));

    await query(
      `INSERT INTO visitor_logs (ip_address, user_agent, path) VALUES ($1, $2, $3)`,
      [ip, ua, path || '/']
    );

    await query(
      `INSERT INTO visitor_stats (date, visits, unique_visitors)
       VALUES (CURRENT_DATE, 1, 1)
       ON CONFLICT (date) DO UPDATE SET
         visits = visitor_stats.visits + 1,
         unique_visitors = (
           SELECT COUNT(DISTINCT ip_address) FROM visitor_logs
           WHERE created_at >= CURRENT_DATE
         ),
         updated_at = NOW()`
    );

    return success({ ok: true });
  } catch {
    return success({ ok: true });
  }
}

export async function GET(request: NextRequest) {
  try {
    const today = await query(
      `SELECT visits, unique_visitors FROM visitor_stats WHERE date = CURRENT_DATE`
    );

    const totalRes = await query('SELECT COUNT(*) as count FROM visitor_logs');
    const totalVisits = parseInt(totalRes.rows[0].count);

    const weeklyRes = await query(
      `SELECT date, visits FROM visitor_stats WHERE date >= CURRENT_DATE - INTERVAL '7 days' ORDER BY date`
    );

    return success({
      today: today.rows[0] || { visits: 0, unique_visitors: 0 },
      totalVisits,
      weekly: weeklyRes.rows,
    });
  } catch {
    return success({
      today: { visits: 0, unique_visitors: 0 },
      totalVisits: 0,
      weekly: [],
    });
  }
}
