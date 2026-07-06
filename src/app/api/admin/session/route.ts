import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const token = bearerToken || request.cookies.get('admin_token')?.value || '';

  if (!token) {
    return error('Unauthorized', 401);
  }

  const payload = verifyToken(token);
  if (!payload) {
    return error('Invalid or expired token', 401);
  }

  const res = await query(
    `SELECT id, name, email, is_active
     FROM admin_users
     WHERE id = $1`,
    [payload.userId]
  );

  if (res.rows.length === 0) {
    return error('Admin not found', 401);
  }

  const admin = res.rows[0];

  if (!admin.is_active) {
    return error('Account inactive', 403);
  }

  return success({
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: payload.role,
  });
}
