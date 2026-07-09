import { NextRequest } from 'next/server';
import { verifyToken, verifyPassword } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

export interface AdminPayload {
  userId: string;
  role: string;
}

// @ts-ignore
const sb = () => getSupabase() as any;

export async function verifyAdminToken(request: NextRequest): Promise<AdminPayload | null> {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') return null;
  return payload;
}

export async function verifyMasterPassword(adminId: string, masterPassword: string): Promise<boolean> {
  const s = sb();
  const { data, error } = await s.from('admin_users')
    .select('master_password_hash')
    .eq('id', adminId)
    .single();
  if (error || !data) return false;
  return verifyPassword(masterPassword, data.master_password_hash);
}

export async function auditLog(
  adminId: string,
  action: string,
  details?: string,
  targetType?: string,
  targetId?: string
): Promise<void> {
  const s = sb();
  await s.from('admin_audit_log').insert({
    admin_id: adminId,
    action,
    details: details || null,
    target_type: targetType || null,
    target_id: targetId || null,
  });
}
