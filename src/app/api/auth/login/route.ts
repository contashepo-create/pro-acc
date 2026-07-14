import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, setAuthCookie } from '@/lib/api-helpers';
import { verifyPassword, createToken } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';
import { checkRateLimit } from '@/lib/rate-limit';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string; password: string }>(request);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { email, password } = parsed.data;
    const s = sb();

    // Rate limiting check
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    const rateLimit = await checkRateLimit(email.toLowerCase(), ip);
    if (!rateLimit.allowed) {
      return error(`تم حظر محاولات الدخول مؤقتاً. حاول بعد ${rateLimit.remainingMinutes} دقائق`, 429);
    }

    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, password_hash, role, is_active, company_id')
      .eq('email', email.toLowerCase()).single();

    if (userErr || !user) return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    const u = user as { id: string; name: string; email: string; password_hash: string; role: string; is_active: boolean; company_id: string };
    if (!u.is_active) return error('هذا الحساب غير نشط. تواصل مع مدير النظام', 403);

    const { data: company, error: companyErr } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active')
      .eq('id', u.company_id).single();
    const c = company as { id: string; is_active: boolean; name: string } | null;
    if (!c || !c.is_active) return error('الشركة غير نشطة. تواصل مع مدير النظام', 403);

    const valid = await verifyPassword(password, u.password_hash);
    if (!valid) {
      // Log failed attempt for rate limiting
      try {
        await s.from('login_attempts').insert({
          email: email.toLowerCase(),
          ip_address: ip,
          success: false,
          attempted_at: new Date().toISOString(),
        });
      } catch {}
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    try {
      const { data: uv } = await s.from('users').select('email_verified').eq('id', u.id).single();
      if (uv && uv.email_verified === false) {
        // Allow login if SMTP is not configured (can't verify email anyway)
        const smtpConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
        if (smtpConfigured) {
          return error('يرجى تأكيد بريدك الإلكتروني أولاً', 403);
        }
        // If SMTP not configured, allow login but warn
        console.warn('Email verification bypassed — SMTP not configured');
      }
    } catch {}

    try { 
      await s.from('users').update({ last_login: new Date().toISOString() }).eq('id', u.id);
      // Log successful attempt
      await s.from('login_attempts').insert({
        email: email.toLowerCase(),
        ip_address: ip,
        success: true,
        attempted_at: new Date().toISOString(),
      });
    } catch {}

    let subscriptionExpired = false;
    let subscriptionMessage = '';
    try {
      const { data: sub } = await s.from('subscriptions')
        .select('status, end_date, trial_extended').eq('company_id', u.company_id)
        .order('end_date', { ascending: false }).limit(1).single();
      if (sub) {
        const subTyped = sub as { status: string; end_date: string; trial_extended: boolean };
        const endDate = new Date(subTyped.end_date);
        const isExpired = endDate < new Date();
        if (isExpired) {
          subscriptionExpired = true;
          if (subTyped.status === 'trial') {
            // Trial expired - check if extended
            if (subTyped.trial_extended) {
              subscriptionMessage = 'انتهت المدة التجريبية الممددة. يرجى الاشتراك للمتابعة';
            } else {
              subscriptionMessage = 'انتهت المدة التجريبية (7 أيام). يمكنك طلب تمديد 7 أيام إضافية من الإدارة أو الاشتراك';
            }
          } else {
            subscriptionMessage = 'انتهت صلاحية الاشتراك. يرجى تجديد الاشتراك للدخول';
          }
        }
      }
    } catch {}

    if (subscriptionExpired) return error(subscriptionMessage || 'انتهت صلاحية الاشتراك. يرجى تجديد الاشتراك للدخول', 403);

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

    setAuthCookie(response, 'token', token, 86400 * 7);

    return response;
  } catch (err) {
    return serverError(err);
  }
}
