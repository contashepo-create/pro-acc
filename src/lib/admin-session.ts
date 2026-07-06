import { query } from '@/lib/db';

export interface AdminSessionData {
  email: string;
  code: string;
  step: 'code_sent' | 'telegram_verified';
  codeSent: boolean;
  expiresAt: number;
}

const TTL = 30 * 60 * 1000;

export async function setSession(adminId: string, data: AdminSessionData): Promise<void> {
  await query(
    `UPDATE admin_users
     SET telegram_code = $1,
         telegram_code_expires = NOW() + INTERVAL '5 minutes',
         master_verified = false,
         login_session_data = $2::jsonb
     WHERE id = $3`,
    [data.code, JSON.stringify(data), adminId]
  );
}

export async function getSession(adminId: string): Promise<AdminSessionData | null> {
  const res = await query(
    `SELECT login_session_data
     FROM admin_users
     WHERE id = $1`,
    [adminId]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  if (!row.login_session_data) return null;

  const session = row.login_session_data as AdminSessionData;
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
  await query(
    `UPDATE admin_users
     SET telegram_code = NULL,
         telegram_code_expires = NULL,
         master_verified = false,
         login_session_data = NULL
     WHERE id = $1`,
    [adminId]
  );
}

export async function cleanupExpiredSessions(): Promise<void> {
  await query(
    `UPDATE admin_users
     SET telegram_code = NULL,
         telegram_code_expires = NULL,
         master_verified = false,
         login_session_data = NULL
     WHERE (telegram_code_expires IS NOT NULL AND telegram_code_expires < NOW())
        OR (login_session_data IS NOT NULL AND (login_session_data->>'expiresAt')::bigint < EXTRACT(EPOCH FROM NOW())::bigint * 1000)`
  );
}
