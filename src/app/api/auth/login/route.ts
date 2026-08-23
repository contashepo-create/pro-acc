import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, setAuthCookie } from '@/lib/api-helpers';
import { verifyPassword, createToken } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { getSupabase } from '@/lib/supabase-client';
import { checkRateLimit } from '@/lib/rate-limit';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string; password: string }>(request);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();
    const s = sb();

    // Rate limiting check
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    const rateLimit = await checkRateLimit(normalizedEmail, ip);
    if (!rateLimit.allowed) {
      return error(`تم حظر محاولات الدخول مؤقتاً. حاول بعد ${rateLimit.remainingMinutes} دقائق`, 429);
    }

    const { data: users, error: userErr } = await s.from('users')
      .select('id, name, email, password_hash, role, is_active, company_id, token_version, email_verified')
      .eq('email', normalizedEmail).limit(2);

    if (userErr) {
      // DATABASE/QUERY error must NOT masquerade as "wrong credentials" —
      // log the real cause so the 401 becomes diagnosable in server logs.
      console.error('[login] users query failed (db/schema issue?):', JSON.stringify(userErr));
      return serverError(userErr);
    }
    if (!users || users.length === 0) {
      const { error: attemptErr } = await s.from('login_attempts').insert({
        email: normalizedEmail, ip_address: ip, success: false,
        attempted_at: new Date().toISOString(),
      });
      if (attemptErr) throw attemptErr;
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }
    if (users.length > 1) {
      // A uniqueness invariant violation must not make authentication choose an
      // arbitrary identity based on row order.
      throw new Error('Duplicate normalized user email');
    }

    const u = users[0] as { id: string; name: string; email: string; password_hash: string; role: string; is_active: boolean; company_id: string; token_version: number; email_verified: boolean };

    if (!u.is_active) return error('هذا الحساب غير نشط. تواصل مع مدير النظام', 403);

    const { data: company, error: companyErr } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active')
      .eq('id', u.company_id).single();
    if (companyErr) throw companyErr;
    const c = company as { id: string; is_active: boolean; name: string } | null;
    if (!c || !c.is_active) return error('الشركة غير نشطة. تواصل مع مدير النظام', 403);

    if (!u.password_hash || !u.password_hash.includes(':')) {
      console.error('[login] 401: stored password_hash has invalid format for user', u.id, '— (أُنشئ خارج النظام؟ أعد تعيين كلمة المرور)');
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }
    const valid = await verifyPassword(password, u.password_hash);
    if (!valid) {
      // Recording failures is part of rate-limit enforcement; fail closed if
      // the backing table cannot accept the attempt.
      const { error: attemptErr } = await s.from('login_attempts').insert({
        email: normalizedEmail,
        ip_address: ip,
        success: false,
        attempted_at: new Date().toISOString(),
      });
      if (attemptErr) throw attemptErr;
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    if (u.email_verified === false) {
      // Development may expose mail preview links, but production never issues
      // a session before mailbox ownership is proven.
      if (process.env.NODE_ENV === 'production') {
        return error('يرجى تأكيد بريدك الإلكتروني أولاً', 403);
      }
      console.warn('Email verification bypassed outside production — configure email before deployment');
    }

    const loginAt = new Date().toISOString();
    const { error: lastLoginErr } = await s.from('users')
      .update({ last_login: loginAt }).eq('id', u.id).eq('company_id', u.company_id);
    if (lastLoginErr) throw lastLoginErr;
    const { error: successAttemptErr } = await s.from('login_attempts').insert({
      email: normalizedEmail,
      ip_address: ip,
      success: true,
      attempted_at: loginAt,
    });
    if (successAttemptErr) throw successAttemptErr;

    // Subscription-status check: do NOT block login entirely when expired.
    // Users must still be able to sign in to view data, contact support, enter
    // an activation code, or buy an add-on. The subscription guard already
    // blocks WRITES on expired accounts; here we just surface state so the UI
    // can show the banner and disable write actions.
    let subscriptionStatus: 'active' | 'trial' | 'pending' | 'expired' | 'trial_expired' | 'cancelled' | 'missing' = 'active';
    let subscriptionMessage = '';
    let endDateStr: string | null = null;
    let daysRemaining = 0;
    try {
      const { getSubscriptionAccess } = await import('@/lib/subscription-guard');
      const access = await getSubscriptionAccess(u.company_id);
      subscriptionStatus = access.status;
      endDateStr = access.endDate;
      daysRemaining = access.daysRemaining;
      if (access.isExpired) {
        subscriptionMessage =
          access.status === 'trial_expired'
            ? 'انتهت المدة التجريبية (7 أيام). يمكنك الاشتراك أو إدخال كود تفعيل أو التواصل مع الدعم.'
            : access.status === 'cancelled'
              ? 'تم إلغاء الاشتراك. يرجى التواصل مع الدعم أو الاشتراك مجدداً.'
              : access.status === 'missing'
                ? 'لا يوجد اشتراك فعّال لهذه الشركة.'
                : 'انتهت صلاحية الاشتراك. يمكنك التجديد أو إدخال كود تفعيل أو التواصل مع الدعم.';
      }
    } catch (e) {
      console.error('[login] subscription access check failed:', e);
      throw e;
    }

    const token = createToken(u.id, u.role, Number((u as Row).token_version) || 0);
    const { password_hash: _, ...safeUser } = u;

    // SECURITY: the session JWT travels ONLY in the HttpOnly cookie. Embedding
    // it in the JSON body would let any XSS read it and fully neutralize the
    // httpOnly protection, so the response must never carry a token field.
    const response = success({
      user: safeUser,
      company: {
        id: c.id, name: c.name,
        registrationNumber: (c as Row).commercial_registration,
        taxNumber: (c as Row).tax_number, vatNumber: (c as Row).vat_number || (c as Row).tax_number,
        address: (c as Row).address, phone: (c as Row).phone, email: (c as Row).email, logo: null,
      },
      subscription: {
        status: subscriptionStatus,
        is_expired: subscriptionStatus === 'pending' || subscriptionStatus === 'expired' || subscriptionStatus === 'trial_expired' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'missing',
        message: subscriptionMessage || null,
        end_date: endDateStr,
        days_remaining: daysRemaining,
      },
    });

    setAuthCookie(response, 'token', token, 86400 * 7);

    return response;
  } catch (err) {
    return serverError(err);
  }
}
