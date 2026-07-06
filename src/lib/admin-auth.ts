import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';

export interface AdminPayload {
  userId: string;
  role: string;
}

export async function verifyAdminToken(request: NextRequest): Promise<AdminPayload | null> {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') return null;
  return payload;
}

export async function verifyMasterPassword(adminId: string, masterPassword: string): Promise<boolean> {
  const res = await query(
    `SELECT master_password_hash FROM admin_users WHERE id = $1`,
    [adminId]
  );
  if (res.rows.length === 0) return false;
  return verifyPassword(masterPassword, res.rows[0].master_password_hash);
}

export async function auditLog(
  adminId: string,
  action: string,
  details?: string,
  targetType?: string,
  targetId?: string
): Promise<void> {
  await query(
    `INSERT INTO admin_audit_log (admin_id, action, details, target_type, target_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, action, details || null, targetType || null, targetId || null]
  );
}
