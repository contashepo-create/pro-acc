import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export interface AdminSessionData {
  email: string;
  code: string;
  step: 'code_sent' | 'telegram_verified';
  codeSent: boolean;
  expiresAt: number;
}

const TTL = 30 * 60 * 1000;

export async function setSession(adminId: string, data: AdminSessionData): Promise<void> {
  const s = sb();
  await s.from('admin_users').update({
    telegram_code: data.code,
    telegram_code_expires: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    master_verified: false,
    login_session_data: data,
  }).eq('id', adminId);
}

export async function getSession(adminId: string): Promise<AdminSessionData | null> {
  const s = sb();
  const { data, error } = await s.from('admin_users')
    .select('login_session_data')
    .eq('id', adminId)
    .single();

  if (error || !data) return null;
  const session = data.login_session_data as AdminSessionData;
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    await deleteSession(adminId);
    return null;
  }
  return session;
}

export async function updateSession(adminId: string, updates: Partial<Pick<AdminSessionData, 'step' | 'codeSent'>>): Promise<void> {
  const session = await getSession(adminId);
  if (!session) return;
  Object.assign(session, updates);
  await setSession(adminId, session);
}

export async function deleteSession(adminId: string): Promise<void> {
  const s = sb();
  await s.from('admin_users').update({
    telegram_code: null,
    telegram_code_expires: null,
    master_verified: false,
    login_session_data: null,
  }).eq('id', adminId);
}

export async function cleanupExpiredSessions(): Promise<void> {
  // Non-critical — skip for now
}
