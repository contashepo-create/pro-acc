import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;
    if (!token) return unauthorized();

    const payload = verifyToken(token);
    if (!payload) return unauthorized();

    const s = sb();

    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, role, is_active, last_login, company_id, created_at')
      .eq('id', payload.userId).single();

    if (userErr || !user) return notFound();
    const u: any = user;
    if (!u.is_active) return error('هذا الحساب غير نشط', 403);

    const { data: company } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active')
      .eq('id', u.company_id).single();
    const c: any = company;

    return success({
      user: {
        id: u.id, name: u.name, email: u.email, role: u.role,
        isActive: u.is_active, lastLogin: u.last_login, createdAt: u.created_at,
      },
      company: c || null,
    });
  } catch (err) {
    return serverError(err);
  }
}
