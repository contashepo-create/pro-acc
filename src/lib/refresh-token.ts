import { getSupabase } from '@/lib/supabase-client';
import { randomBytes, createHash } from 'crypto';
import { createToken } from '@/lib/auth';

// @ts-ignore
const sb = () => getSupabase();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createRefreshToken(userId: string, ip?: string, userAgent?: string): Promise<{ token: string; id: string }> {
  const s = sb();
  const rawToken = randomBytes(64).toString('hex');
  const hashed = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  const { data, error } = await s.from('refresh_tokens')
    .insert({
      user_id: userId,
      token_hash: hashed,
      expires_at: expiresAt,
      ip_address: ip || null,
      user_agent: userAgent || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  return { token: rawToken, id: data.id };
}

export async function verifyRefreshToken(rawToken: string): Promise<{ userId: string; tokenId: string } | null> {
  const s = sb();
  const hashed = hashToken(rawToken);

  const { data, error } = await s.from('refresh_tokens')
    .select('id, user_id, expires_at, revoked')
    .eq('token_hash', hashed)
    .eq('revoked', false)
    .maybeSingle();

  if (error || !data) return null;
  
  if (new Date(data.expires_at) < new Date()) {
    // Expired, revoke it
    await s.from('refresh_tokens').update({ revoked: true }).eq('id', data.id);
    return null;
  }

  return { userId: data.user_id, tokenId: data.id };
}

export async function rotateRefreshToken(oldRawToken: string, ip?: string, userAgent?: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const s = sb();
  const verified = await verifyRefreshToken(oldRawToken);
  if (!verified) return null;

  const hashed = hashToken(oldRawToken);

  // Revoke old token
  await s.from('refresh_tokens').update({ revoked: true }).eq('id', verified.tokenId);

  // Create new tokens
  const { token: newRefreshToken, id: newId } = await createRefreshToken(verified.userId, ip, userAgent);

  // Link old to new for audit
  await s.from('refresh_tokens').update({ replaced_by: newId }).eq('id', verified.tokenId);

  // Get user role
  const { data: user } = await s.from('users').select('role').eq('id', verified.userId).single();
  const role = user?.role || 'accountant';

  const accessToken = createToken(verified.userId, role);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  const s = sb();
  await s.from('refresh_tokens').update({ revoked: true }).eq('user_id', userId).eq('revoked', false);
}

export async function cleanupExpiredTokens(): Promise<number> {
  const s = sb();
  const { data } = await s.from('refresh_tokens')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('id');
  return data?.length || 0;
}
