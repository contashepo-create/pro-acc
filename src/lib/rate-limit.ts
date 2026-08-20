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

/**
 * Sanitize an email address before interpolating it into a PostgREST `.or()`
 * filter string. Characters that PostgREST treats as filter syntax
 * (commas, parentheses, quotes, colons, operators) are stripped, which
 * neutralizes filter-injection / rate-limit-bypass attempts via crafted
 * emails (e.g. `a@b.com,or(id.neq.null)`).
 */
export function sanitizeEmailForFilter(email: string): string {
  const cleaned = (email || '').toLowerCase().trim().replace(/[^a-z0-9._%+\-@]/g, '');
  // If nothing resembling an email survives, use a sentinel that matches no row.
  return cleaned.length > 0 ? cleaned.slice(0, 254) : 'invalid-email@example.invalid';
}

export async function checkRateLimit(
  email: string,
  ipAddress: string
): Promise<{ allowed: boolean; remainingMinutes: number }> {
  const s = sb();

  // SECURITY FIX: Sanitize IP address to prevent PostgREST filter injection
  const safeIp = sanitizeIpAddress(ipAddress);
  // SECURITY FIX: Sanitize email too — it is user-controlled and previously
  // interpolated raw into the `.or()` filter (PostgREST injection vector).
  const safeEmail = sanitizeEmailForFilter(email);

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60000).toISOString();

  const { data: attempts, error } = await s.from('login_attempts')
    .select('attempted_at')
    .or(`email.eq.${safeEmail},ip_address.eq.${safeIp}`)
    .eq('success', false)
    .gte('attempted_at', fifteenMinutesAgo)
    .order('attempted_at');

  if (error) {
    console.error('Rate limit check error:', error);
    throw error;
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

/**
 * Rate-limit for password-reset / resend-verification endpoints.
 *
 * Unlike checkRateLimit (which counts login_attempts), this counts rows in the
 * dedicated `password_reset_requests` table that these endpoints DO write to,
 * so repeated resets are actually throttled. Limit is per (email OR IP) within
 * the window.
 */
export async function checkPasswordResetRateLimit(
  email: string,
  ipAddress: string,
  opts: { maxRequests?: number; windowMinutes?: number } = {}
): Promise<{ allowed: boolean; remainingMinutes: number }> {
  const s = sb();
  const maxRequests = Math.max(1, opts.maxRequests ?? 3);
  const windowMinutes = Math.max(1, opts.windowMinutes ?? 15);
  const since = new Date(Date.now() - windowMinutes * 60000).toISOString();
  const safeIp = sanitizeIpAddress(ipAddress);
  const safeEmail = sanitizeEmailForFilter(email);

  const { data, error } = await s.from('password_reset_requests')
    .select('created_at')
    .or(`email.eq.${safeEmail},ip_address.eq.${safeIp}`)
    .gte('created_at', since)
    .order('created_at');

  if (error) {
    console.error('Password-reset rate limit check error:', error);
    throw error;
  }

  const count = (data || []).length;
  if (count >= maxRequests) {
    // maxRequests is clamped to >=1, therefore a blocked result always has a first row.
    const elapsedMs = Date.now() - new Date(data![0].created_at).getTime();
    const remainingMs = windowMinutes * 60000 - elapsedMs;
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    return { allowed: false, remainingMinutes };
  }

  return { allowed: true, remainingMinutes: 0 };
}

/**
 * Record a password-reset / resend request so the throttle above has rows to
 * count. Returns the inserted row id (for updating delivery status).
 */
export async function recordPasswordResetRequest(
  email: string,
  ipAddress: string
): Promise<string | null> {
  const safeIp = sanitizeIpAddress(ipAddress);
  const { data, error } = await sb().from('password_reset_requests')
    .insert({ email: email.toLowerCase().trim(), ip_address: safeIp, status: 'requested' })
    .select('id').single();
  if (error) throw error;
  return data?.id || null;
}

/** Update a recorded request's delivery outcome for diagnostics. */
export async function markPasswordResetRequest(
  id: string | null,
  status: 'delivered' | 'failed',
  errorText?: string
): Promise<void> {
  if (!id) return;
  try {
    await sb().from('password_reset_requests')
      .update({ status, error: errorText || null })
      .eq('id', id);
  } catch (err) {
    console.error('Failed to update password-reset request status:', err);
  }
}

/**
 * Registration rate limit: per (email OR IP) inside the window, backed by the
 * dedicated `registration_attempts` table so repeated sign-ups from one
 * source are actually throttled (bot/account-farming defense on top of the
 * Turnstile check).
 */
export async function checkRegistrationRateLimit(
  email: string,
  ipAddress: string,
  opts: { maxAttempts?: number; windowMinutes?: number } = {}
): Promise<{ allowed: boolean; remainingMinutes: number }> {
  const s = sb();
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  const windowMinutes = Math.max(1, opts.windowMinutes ?? 60);
  const since = new Date(Date.now() - windowMinutes * 60000).toISOString();
  const safeIp = sanitizeIpAddress(ipAddress);
  const safeEmail = sanitizeEmailForFilter(email);

  const { data, error } = await s.from('registration_attempts')
    .select('created_at')
    .or(`email.eq.${safeEmail},ip_address.eq.${safeIp}`)
    .gte('created_at', since)
    .order('created_at');

  if (error) {
    console.error('Registration rate limit check error:', error);
    throw error;
  }

  const count = (data || []).length;
  if (count >= maxAttempts) {
    // maxAttempts is clamped to >=1, therefore a blocked result always has a first row.
    const elapsedMs = Date.now() - new Date(data![0].created_at).getTime();
    const remainingMs = windowMinutes * 60000 - elapsedMs;
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    return { allowed: false, remainingMinutes };
  }

  return { allowed: true, remainingMinutes: 0 };
}

/** Record a registration attempt so the throttle above has rows to count. */
export async function recordRegistrationAttempt(email: string, ipAddress: string): Promise<void> {
  const safeIp = sanitizeIpAddress(ipAddress);
  const { error } = await sb().from('registration_attempts')
    .insert({ email: email.toLowerCase().trim(), ip_address: safeIp });
  if (error) throw error;
}
