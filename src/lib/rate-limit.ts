import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Validate and sanitize an IP address to prevent filter injection attacks.
 * Only allows valid IPv4 or IPv6 format, or the literal 'unknown'.
 * This prevents attackers from injecting PostgREST syntax via x-forwarded-for.
 */
function sanitizeIpAddress(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';

  // Trim whitespace
  const trimmed = ip.trim();

  // IPv4 pattern: 1-3 digits dot-separated, 4 groups
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 pattern: simplified check for hex groups separated by colons
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/;
  // IPv6 with embedded IPv4
  const ipv6MappedPattern = /^::ffff:(\d{1,3}\.){3}\d{1,3}$/;

  if (ipv4Pattern.test(trimmed)) {
    const octets = trimmed.split('.').map(Number);
    if (octets.every(o => o >= 0 && o <= 255)) {
      return trimmed;
    }
    // Invalid IPv4 octets - reject
    console.warn('Invalid IPv4 address (octets out of range):', trimmed.substring(0, 50));
    return 'unknown';
  }
  
  if (ipv6Pattern.test(trimmed) || ipv6MappedPattern.test(trimmed)) {
    return trimmed;
  }

  // If not a valid IP, return 'unknown' to prevent injection
  console.warn('Invalid IP address format rejected:', trimmed.substring(0, 50));
  return 'unknown';
}

export async function checkRateLimit(
  email: string,
  ipAddress: string
): Promise<{ allowed: boolean; remainingMinutes: number }> {
  const s = sb();
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60000).toISOString();

  // SECURITY FIX: Sanitize IP address to prevent PostgREST filter injection
  const safeIp = sanitizeIpAddress(ipAddress);

  const { data: attempts, error } = await s.from('login_attempts')
    .select('attempted_at')
    .or(`email.eq.${email},ip_address.eq.${safeIp}`)
    .eq('success', false)
    .gte('attempted_at', fifteenMinutesAgo)
    .order('attempted_at');

  if (error) {
    console.error('Rate limit check error:', error);
    // Fail-Open by design: if DB is unreachable, allow login but log the issue.
    // This is a deliberate availability-over-security tradeoff.
    // NOTE: SECURITY_FINAL_REPORT.md should be updated to reflect this decision.
    return { allowed: true, remainingMinutes: 0 };
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
