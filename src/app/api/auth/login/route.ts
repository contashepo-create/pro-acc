import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyPassword, createToken } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string; password: string }>(request);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return error(parsed.error.issues[0].message);
    }

    const { email, password } = parsed.data;
    const supabase = getSupabase();

    // Get user with company info
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, name, email, password_hash, role, is_active, company_id')
      .eq('email', email.toLowerCase())
      .single();

    if (userErr || !user) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    if (!user.is_active) {
      return error('هذا الحساب غير نشط. تواصل مع مدير النظام', 403);
    }

    // Get company
    const { data: company } = await supabase
      .from('companies')
      .select('id, name, commercial_registration, tax_number, vat_number, address, phone, email, logo, is_active')
      .eq('id', user.company_id)
      .single();

    if (!company || !company.is_active) {
      return error('الشركة غير نشطة. تواصل مع مدير النظام', 403);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    // Check email_verified if column exists
    try {
      const { data: uv } = await supabase
        .from('users')
        .select('email_verified')
        .eq('id', user.id)
        .single();
      if (uv && uv.email_verified === false) {
        return error('يرجى تأكيد بريدك الإلكتروني أولاً', 403);
      }
    } catch {}

    // Update last_login
    try { await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id); } catch {}

    // Check subscription
    let subscriptionExpired = false;
    try {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status, end_date')
        .eq('company_id', user.company_id)
        .order('end_date', { ascending: false })
        .limit(1)
        .single();
      if (sub) {
        const endDate = new Date(sub.end_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (endDate < today && sub.status !== 'trial') subscriptionExpired = true;
      }
    } catch {}

    if (subscriptionExpired) {
      return error('انتهت صلاحية الاشتراك. يرجى تجديد الاشتراك للدخول', 403);
    }

    const token = createToken(user.id, user.role);

    const { password_hash: _, ...safeUser } = user;

    const response = success({
      user: safeUser,
      company: {
        id: company.id,
        name: company.name,
        registrationNumber: company.commercial_registration,
        taxNumber: company.tax_number,
        vatNumber: company.vat_number,
        address: company.address,
        phone: company.phone,
        email: company.email,
        logo: company.logo,
      },
      token,
    });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 86400 * 7,
      path: '/',
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
