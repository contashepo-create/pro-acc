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
    const normalizedEmail = email.toLowerCase().trim();
    const s = sb();

    // Rate limiting check
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    const rateLimit = await checkRateLimit(normalizedEmail, ip);
    if (!rateLimit.allowed) {
      return error(`تم حظر محاولات الدخول مؤقتاً. حاول بعد ${rateLimit.remainingMinutes} دقائق`, 429);
    }

    const { data: users, error: userErr } = await s.from('users')
      .select('id, name, email, password_hash, role, is_active, company_id, token_version')
      .eq('email', normalizedEmail).limit(2);

    if (userErr) {
      // DATABASE/QUERY error must NOT masquerade as "wrong credentials" —
      // log the real cause so the 401 becomes diagnosable in server logs.
      console.error('[login] users query failed (db/schema issue?):', JSON.stringify(userErr));
      return serverError(userErr);
    }
    if (!users || users.length === 0) {
      console.warn('[login] 401: no user with email', normalizedEmail, '— (wrong email أو قاعدة البيانات فارغة/غير مزامنة)');
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }
    if (users.length > 1) {
      console.error('[login] duplicate rows for email', normalizedEmail, '— migration 013 (email uniqueness) not applied?');
    }

    // BUGFIX (password change appears "not to stick"): when duplicate email
    // rows exist, users[0] is arbitrary — a password change updates the row
    // of the AUTHENTICATED user id, while login could read the OTHER row and
    // keep accepting the old password. Pick the row whose hash matches the
    // submitted password; fall back to users[0] for the failure path.
    let u = users[0] as { id: string; name: string; email: string; password_hash: string; role: string; is_active: boolean; company_id: string };
    if (users.length > 1) {
      for (const candidate of users as typeof u[]) {
        if (candidate.password_hash && candidate.password_hash.includes(':') &&
            await verifyPassword(password, candidate.password_hash)) {
          u = candidate;
          break;
        }
      }
    }
    if (!u.is_active) return error('هذا الحساب غير نشط. تواصل مع مدير النظام', 403);

    const { data: company, error: companyErr } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active')
      .eq('id', u.company_id).single();
    const c = company as { id: string; is_active: boolean; name: string } | null;
    if (!c || !c.is_active) return error('الشركة غير نشطة. تواصل مع مدير النظام', 403);

    if (!u.password_hash || !u.password_hash.includes(':')) {
      console.error('[login] 401: stored password_hash has invalid format for user', u.id, '— (أُنشئ خارج النظام؟ أعد تعيين كلمة المرور)');
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }
    const valid = await verifyPassword(password, u.password_hash);
    if (!valid) {
      console.warn('[login] 401: password mismatch for user', u.id);
      // Log failed attempt for rate limiting
      try {
        await s.from('login_attempts').insert({
          email: normalizedEmail,
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
        // A production account is not active until its mailbox is proven. A
        // missing mail configuration is an operational failure, not a reason
        // to silently downgrade account-verification security.
        if (process.env.NODE_ENV === 'production') {
          return error('يرجى تأكيد بريدك الإلكتروني أولاً', 403);
        }
        console.warn('Email verification bypassed outside production — configure email before deployment');
      }
    } catch {}

    try { 
      await s.from('users').update({ last_login: new Date().toISOString() }).eq('id', u.id);
      // Log successful attempt
      await s.from('login_attempts').insert({
        email: normalizedEmail,
        ip_address: ip,
        success: true,
        attempted_at: new Date().toISOString(),
      });
    } catch {}

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
      console.warn('[login] subscription access check failed:', e);
    }

    const token = createToken(u.id, u.role, Number((u as any).token_version) || 0);
    const { password_hash: _, ...safeUser } = u;

    const response = success({
      user: safeUser,
      company: {
        id: c.id, name: c.name,
        registrationNumber: (c as any).commercial_registration,
        taxNumber: (c as any).tax_number, vatNumber: (c as any).vat_number || (c as any).tax_number,
        address: (c as any).address, phone: (c as any).phone, email: (c as any).email, logo: null,
      },
      subscription: {
        status: subscriptionStatus,
        is_expired: subscriptionStatus === 'pending' || subscriptionStatus === 'expired' || subscriptionStatus === 'trial_expired' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'missing',
        message: subscriptionMessage || null,
        end_date: endDateStr,
        days_remaining: daysRemaining,
      },
      token,
    });

    setAuthCookie(response, 'token', token, 86400 * 7);

    return response;
  } catch (err) {
    return serverError(err);
  }
}
