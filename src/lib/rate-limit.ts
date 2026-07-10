import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function checkRateLimit(
  email: string,
  ipAddress: string
): Promise<{ allowed: boolean; remainingMinutes: number }> {
  const s = sb();
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60000).toISOString();

  const { data: attempts, error } = await s.from('login_attempts')
    .select('attempted_at')
    .or(`email.eq.${email},ip_address.eq.${ipAddress}`)
    .eq('success', false)
    .gte('attempted_at', fifteenMinutesAgo)
    .order('attempted_at');

  if (error) {
    console.error('Rate limit check error:', error);
    // FIXED: Fail-Closed - if DB fails, block request instead of allowing brute force
    return { allowed: false, remainingMinutes: 5 };
  }

  const count = (attempts || []).length;
  const earliest = attempts?.[0]?.attempted_at;

  if (count >= 5 && earliest) {
    const elapsedMs = Date.now() - new Date(earliest).getTime();
    const remainingMs = 15 * 60 * 1000 - elapsedMs;
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    return { allowed: false, remainingMinutes };
  }

  return { allowed: true, remainingMinutes: 0 };
}
