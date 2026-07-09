import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value || '';

  if (!token) {
    return error('Unauthorized', 401);
  }

  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') {
    return error('Invalid or expired token', 401);
  }

  const s = sb();
  const { data: admin, error: queryErr } = await s.from('admin_users')
    .select('id, name, email, is_active')
    .eq('id', payload.userId)
    .single();

  if (queryErr || !admin) {
    return error('Admin not found', 401);
  }

  const a: any = admin;
  if (!a.is_active) {
    return error('Account inactive', 403);
  }

  return success({
    id: a.id,
    name: a.name,
    email: a.email,
    role: payload.role,
  });
}
