import { NextRequest } from 'next/server';
import { verifyAdminToken as verifyAdminJwt, verifyPassword } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from './types';

export interface AdminPayload {
  userId: string;
  role: string;
}

const sb = () => getSupabase();

/**
 * Verify an incoming request's admin JWT and the DB is_active flag.
 *
 * @deprecated Use `requireAdmin()` from `@/lib/admin-guard` for API endpoints.
 */
export async function verifyAdminToken(request: NextRequest): Promise<AdminPayload | null> {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) return null;
  const payload = verifyAdminJwt(token);
  if (!payload) return null;
  try {
    const s = sb();
    const { data } = await s
      .from('admin_users')
      .select('id, is_active, token_version')
      .eq('id', payload.userId)
      .maybeSingle();
    if (!data || !(data as Row).is_active) return null;
    if (payload.ver !== (Number((data as Row).token_version) || 0)) return null;
    return { userId: String((data as Row).id), role: 'superadmin' };
  } catch {
    return null;
  }
}

export async function verifyMasterPassword(adminId: string, masterPassword: string): Promise<boolean> {
  if (!adminId || !masterPassword) return false;
  try {
    const s = sb();
    const { data, error } = await s.from('admin_users')
      .select('master_password_hash')
      .eq('id', adminId)
      .maybeSingle();
    if (error || !data || !(data as Row).master_password_hash) return false;
    return verifyPassword(String(masterPassword), String((data as Row).master_password_hash));
  } catch {
    return false;
  }
}

export async function auditLog(
  adminId: string,
  action: string,
  details?: string,
  targetType?: string,
  targetId?: string,
  ip?: string
): Promise<void> {
  try {
    const s = sb();
    const payload: Record<string, unknown> = {
      admin_id: adminId,
      action: String(action).slice(0, 64),
      details: details ? String(details).slice(0, 2000) : null,
      target_type: targetType ? String(targetType).slice(0, 32) : null,
      target_id: targetId ? String(targetId).slice(0, 64) : null,
    };
    if (ip) payload.ip_address = String(ip).slice(0, 64);
    await s.from('admin_audit_log').insert(payload);
  } catch (e) {
    console.warn('[auditLog] failed:', e);
  }
}
