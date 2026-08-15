import { timingSafeEqual } from 'crypto';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[0-9a-f]{64}$/i;

export interface AdminSessionData {
  sessionId: string;
  email: string;
  /** SHA-256 digest of the OTP. The plaintext is never persisted. */
  codeHash: string;
  step: 'code_sent' | 'telegram_verified';
  codeSent: boolean;
  otpExpiresAt: number;
  attempts: number;
  lastResendAt: number;
  expiresAt: number;
}

export function parseAdminSessionPointer(pointer: string): { adminId: string; sessionId: string } | null {
  const separator = pointer.indexOf('.');
  if (separator < 0) return null;
  const adminId = pointer.slice(0, separator);
  const sessionId = pointer.slice(separator + 1);
  return UUID_RE.test(adminId) && NONCE_RE.test(sessionId) ? { adminId, sessionId } : null;
}

function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function setSession(adminId: string, data: AdminSessionData): Promise<void> {
  if (!UUID_RE.test(adminId) || !NONCE_RE.test(data.sessionId) || !NONCE_RE.test(data.codeHash)) {
    throw new Error('Invalid admin session data');
  }
  const s = sb();
  const { data: updated, error } = await s.from('admin_users').update({
    // Compatibility column also receives only a digest.
    telegram_code: data.codeHash,
    telegram_code_expires: new Date(data.otpExpiresAt).toISOString(),
    master_verified: false,
    login_session_data: data,
  }).eq('id', adminId).select('id').maybeSingle();
  if (error || !updated) throw error || new Error('Admin session owner not found');
}

export async function getSession(pointer: string): Promise<AdminSessionData | null> {
  const parsed = parseAdminSessionPointer(pointer);
  if (!parsed) return null;
  const s = sb();
  const { data, error } = await s.from('admin_users')
    .select('login_session_data, is_active')
    .eq('id', parsed.adminId)
    .single();

  if (error || !data || !(data as any).is_active) return null;
  const session = data.login_session_data as AdminSessionData;
  if (!session || !NONCE_RE.test(session.sessionId || '') || !equalSecret(session.sessionId, parsed.sessionId)) return null;

  if (Date.now() > session.expiresAt) {
    await deleteSession(pointer);
    return null;
  }
  if (session.step === 'code_sent' && (!Number.isFinite(session.otpExpiresAt) || Date.now() > session.otpExpiresAt)) {
    await deleteSession(pointer);
    return null;
  }
  return session;
}

export async function updateSession(pointer: string, updates: Partial<AdminSessionData>): Promise<void> {
  const parsed = parseAdminSessionPointer(pointer);
  if (!parsed) throw new Error('Invalid admin session');
  const session = await getSession(pointer);
  if (!session) throw new Error('Admin session expired');
  // A session identifier is immutable during its lifetime.
  const next = { ...session, ...updates, sessionId: session.sessionId };
  await setSession(parsed.adminId, next);
}

export async function deleteSession(pointer: string): Promise<void> {
  const parsed = parseAdminSessionPointer(pointer);
  if (!parsed) return;
  const s = sb();
  // Bind cleanup to the nonce so an old cookie cannot destroy a newer login.
  const { error } = await s.from('admin_users').update({
    telegram_code: null,
    telegram_code_expires: null,
    master_verified: false,
    login_session_data: null,
  }).eq('id', parsed.adminId).contains('login_session_data', { sessionId: parsed.sessionId });
  if (error) throw error;
}

export async function cleanupExpiredSessions(): Promise<void> {
  // Expired sessions are removed when accessed; scheduled cleanup is optional.
}
