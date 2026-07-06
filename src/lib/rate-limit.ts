import { query } from '@/lib/db';

export async function checkRateLimit(
  email: string,
  ipAddress: string
): Promise<{ allowed: boolean; remainingMinutes: number }> {
  const res = await query(
    `SELECT COUNT(*)::int as count,
            MIN(attempted_at) as earliest_attempt
     FROM login_attempts
     WHERE (email = $1 OR ip_address = $2)
       AND success = false
       AND attempted_at > NOW() - INTERVAL '15 minutes'`,
    [email, ipAddress]
  );

  const { count, earliest_attempt } = res.rows[0];

  if (count >= 5 && earliest_attempt) {
    const elapsedMs = Date.now() - new Date(earliest_attempt).getTime();
    const remainingMs = 15 * 60 * 1000 - elapsedMs;
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    return { allowed: false, remainingMinutes };
  }

  return { allowed: true, remainingMinutes: 0 };
}
