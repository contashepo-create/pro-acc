import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound } from '@/lib/api-helpers';
import { verifyToken, extractToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const token = extractToken(request);
    if (!token) {
      // No token at all → user simply isn't logged in; expected on public pages.
      return unauthorized();
    }

    const payload = verifyToken(token);
    if (!payload) {
      // Token present but rejected: wrong TOKEN_SECRET between deployments,
      // expired (7 days), or tampered. Log so a flood of 401s is diagnosable.
      console.warn('[auth/me] 401: token rejected — تحقق من ثبات TOKEN_SECRET بين عمليات النشر أو انتهاء صلاحية التوكن (7 أيام)');
      return unauthorized();
    }

    const s = sb();

    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, role, is_active, last_login, company_id, created_at')
      .eq('id', payload.userId).single();

    if (userErr || !user) return notFound();
    const u = user as Record<string, any>;
    if (!u.is_active) return error('هذا الحساب غير نشط', 403);

    const { data: company } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active')
      .eq('id', u.company_id).single();
    const c = company as Record<string, any>;

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
