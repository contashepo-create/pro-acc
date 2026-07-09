import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { hashPassword, createToken } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ companyName: string; name: string; email: string; password: string; phone?: string }>(request);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { companyName, name, email, password, phone } = parsed.data;
    const s = sb();

    const { data: existing } = await s.from('users').select('id').eq('email', email.toLowerCase()).limit(1);
    if (existing && existing.length > 0) return error('البريد الإلكتروني مسجل مسبقاً', 409);

    const { data: companyCheck } = await s.from('companies').select('id').eq('name', companyName).limit(1);
    if (companyCheck && companyCheck.length > 0) return error('اسم الشركة موجود مسبقاً', 409);

    const passwordHash = await hashPassword(password);

    const { data: company, error: companyErr } = await s.from('companies')
      .insert({ name: companyName, email: email.toLowerCase(), phone: phone || null, is_active: true })
      .select('id').single();
    if (companyErr || !company) return error('فشل إنشاء الشركة', 500);
    const co: any = company;

    const insertData: any = { company_id: co.id, name, email: email.toLowerCase(), password_hash: passwordHash, role: 'admin', is_active: true };
    let user: any = null;
    const { data: u1, error: e1 } = await s.from('users').insert({ ...insertData, email_verified: true }).select('id, name, email, role').single();
    if (e1) {
      const { data: u2, error: e2 } = await s.from('users').insert(insertData).select('id, name, email, role').single();
      if (e2 || !u2) return error('فشل إنشاء المستخدم', 500);
      user = u2;
    } else { user = u1; }
    if (!user) return error('فشل إنشاء المستخدم', 500);

    try {
      const { data: plan } = await s.from('subscription_plans').select('id').eq('code', 'trial').eq('is_active', true).limit(1).single();
      const p: any = plan;
      if (p) {
        await s.from('subscriptions').upsert({
          company_id: co.id, plan_id: p.id, plan_code: 'trial', status: 'trial',
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
      company: { id: co.id, name: companyName },
      token,
    }, 201);

    response.cookies.set('token', token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', path: '/', maxAge: 86400 * 7,
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
