import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { hashPassword, createToken } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{
      companyName: string;
      name: string;
      email: string;
      password: string;
      phone?: string;
    }>(request);

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { companyName, name, email, password, phone } = parsed.data;
    const supabase = getSupabase();

    // Check duplicate email
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .limit(1);
    if (existing && existing.length > 0) return error('البريد الإلكتروني مسجل مسبقاً', 409);

    // Check duplicate company name
    const { data: companyCheck } = await supabase
      .from('companies')
      .select('id')
      .eq('name', companyName)
      .limit(1);
    if (companyCheck && companyCheck.length > 0) return error('اسم الشركة موجود مسبقاً', 409);

    const passwordHash = await hashPassword(password);

    // Create company
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .insert({ name: companyName, email: email.toLowerCase(), phone: phone || null, is_active: true })
      .select('id')
      .single();
    if (companyErr || !company) return error('فشل إنشاء الشركة', 500);

    // Create user — try with email_verified, fall back without
    let user;
    const insertData: any = {
      company_id: company.id,
      name,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      role: 'admin',
      is_active: true,
    };
    const { data: u1, error: e1 } = await supabase
      .from('users')
      .insert({ ...insertData, email_verified: true })
      .select('id, name, email, role')
      .single();
    if (e1) {
      const { data: u2, error: e2 } = await supabase
        .from('users')
        .insert(insertData)
        .select('id, name, email, role')
        .single();
      if (e2 || !u2) return error('فشل إنشاء المستخدم', 500);
      user = u2;
    } else {
      user = u1;
    }

    // Create trial subscription
    try {
      const { data: plan } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('code', 'trial')
        .eq('is_active', true)
        .limit(1)
        .single();
      if (plan) {
        await supabase.from('subscriptions').upsert({
          company_id: company.id,
          plan_id: plan.id,
          plan_code: 'trial',
          status: 'trial',
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          trial_end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          auto_renew: false,
        }, { onConflict: 'company_id' });
      }
    } catch {}

    const token = createToken(user.id, user.role);

    const response = success({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      company: { id: company.id, name: companyName },
      token,
    }, 201);

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 86400 * 7,
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
