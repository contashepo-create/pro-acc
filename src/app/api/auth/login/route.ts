import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyPassword, createToken } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore - supabase client typing issues
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string; password: string }>(request);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { email, password } = parsed.data;
    const s = sb();

    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, password_hash, role, is_active, company_id')
      .eq('email', email.toLowerCase()).single();

    if (userErr || !user) return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    const u: any = user;
    if (!u.is_active) return error('هذا الحساب غير نشط. تواصل مع مدير النظام', 403);

    const { data: company, error: companyErr } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active')
      .eq('id', u.company_id).single();
    const c: any = company;
    if (!c || !c.is_active) return error('الشركة غير نشطة. تواصل مع مدير النظام', 403);

    const valid = await verifyPassword(password, u.password_hash);
    if (!valid) return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);

    try {
      const { data: uv } = await s.from('users').select('email_verified').eq('id', u.id).single();
      if (uv && uv.email_verified === false) return error('يرجى تأكيد بريدك الإلكتروني أولاً', 403);
    } catch {}

    try { await s.from('users').update({ last_login: new Date().toISOString() }).eq('id', u.id); } catch {}

    let subscriptionExpired = false;
    try {
      const { data: sub } = await s.from('subscriptions')
        .select('status, end_date').eq('company_id', u.company_id)
        .order('end_date', { ascending: false }).limit(1).single();
      if (sub) {
        const endDate = new Date((sub as any).end_date);
        if (endDate < new Date() && (sub as any).status !== 'trial') subscriptionExpired = true;
      }
    } catch {}

    if (subscriptionExpired) return error('انتهت صلاحية الاشتراك. يرجى تجديد الاشتراك للدخول', 403);

    const token = createToken(u.id, u.role);
    const { password_hash: _, ...safeUser } = u;

    const response = success({
      user: safeUser,
      company: {
        id: c.id, name: c.name,
        registrationNumber: c.commercial_registration,
        taxNumber: c.tax_number, vatNumber: c.vat_number || c.tax_number,
        address: c.address, phone: c.phone, email: c.email, logo: null,
      },
      token,
    });

    response.cookies.set('token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', maxAge: 86400 * 7, path: '/',
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
