import { NextRequest } from 'next/server';
import { success } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || '';
    const { path } = await request.json().catch(() => ({ path: '/' }));
    const s = sb();

    await s.from('visitor_logs').insert({
      ip_address: ip,
      user_agent: ua,
      path: path || '/',
    });

    // Update visitor stats
    const today = new Date().toISOString().split('T')[0];

    // Count unique visitors today
    const { count: uniqueCount } = await s.from('visitor_logs')
      .select('ip_address', { count: 'exact', head: true })
      .gte('created_at', today);

    const { data: existing } = await s.from('visitor_stats')
      .select('visits')
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      await s.from('visitor_stats')
        .update({
          visits: existing.visits + 1,
          unique_visitors: uniqueCount || 1,
          updated_at: new Date().toISOString(),
        })
        .eq('date', today);
    } else {
      await s.from('visitor_stats').insert({
        date: today,
        visits: 1,
        unique_visitors: uniqueCount || 1,
      });
    }

    return success({ ok: true });
  } catch {
    return success({ ok: true });
  }
}

export async function GET() {
  try {
    const s = sb();
    const today = new Date().toISOString().split('T')[0];

    const { data: todayStats } = await s.from('visitor_stats')
      .select('visits, unique_visitors')
      .eq('date', today)
      .maybeSingle();

    const { count: totalVisits } = await s.from('visitor_logs')
      .select('*', { count: 'exact', head: true });

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const { data: weekly } = await s.from('visitor_stats')
      .select('date, visits')
      .gte('date', sevenDaysAgo)
      .order('date');

    return success({
      today: todayStats || { visits: 0, unique_visitors: 0 },
      totalVisits: totalVisits || 0,
      weekly: weekly || [],
    });
  } catch {
    return success({
      today: { visits: 0, unique_visitors: 0 },
      totalVisits: 0,
      weekly: [],
    });
  }
}
