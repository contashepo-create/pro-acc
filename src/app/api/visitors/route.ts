import { NextRequest } from 'next/server';
import { success, error, requireAdmin, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

const visitorHits = new Map<string, { n: number; reset: number }>();
function allowVisitorHit(ip: string, max = 30, windowMs = 60 * 60 * 1000): boolean {
  const now = Date.now();
  const rec = visitorHits.get(ip);
  if (!rec || now > rec.reset) {
    visitorHits.set(ip, { n: 1, reset: now + windowMs });
    return true;
  }
  rec.n += 1;
  return rec.n <= max;
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip') || 'unknown';
    if (!allowVisitorHit(ip)) {
      return error('تم تجاوز حد تسجيل الزيارات', 429);
    }
    const ua = (request.headers.get('user-agent') || '').slice(0, 512);
    const raw = await request.json().catch(() => ({ path: '/' })) as { path?: unknown };
    const path = typeof raw.path === 'string' && raw.path.startsWith('/')
      ? raw.path.slice(0, 512)
      : '/';
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

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const s = sb();
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: todayStats } = await s.from('visitor_stats')
      .select('visits, unique_visitors')
      .eq('date', todayStr)
      .maybeSingle();

    const { count: totalVisits } = await s.from('visitor_logs')
      .select('*', { count: 'exact', head: true });

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const { data: weekly } = await s.from('visitor_stats')
      .select('date, visits')
      .gte('date', sevenDaysAgo)
      .order('date');

    const today = todayStats || { visits: 0, unique_visitors: 0 };
    return success({
      today,
      visits: today.visits || 0,
      unique_visitors: today.unique_visitors || 0,
      totalVisits: totalVisits || 0,
      weekly: weekly || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
