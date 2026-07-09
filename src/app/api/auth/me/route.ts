import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;
    if (!token) return unauthorized();

    const payload = verifyToken(token);
    if (!payload) return unauthorized();

    const supabase = getSupabase();

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, name, email, role, is_active, last_login, company_id, created_at')
      .eq('id', payload.userId)
      .single();

    if (userErr || !user) return notFound();
    if (!user.is_active) return error('هذا الحساب غير نشط', 403);

    const { data: company } = await supabase
      .from('companies')
      .select('id, name, commercial_registration, tax_number, vat_number, address, phone, email, logo, is_active')
      .eq('id', user.company_id)
      .single();

    return success({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.is_active,
        lastLogin: user.last_login,
        createdAt: user.created_at,
      },
      company: company || null,
    });
  } catch (err) {
    return serverError(err);
  }
}
